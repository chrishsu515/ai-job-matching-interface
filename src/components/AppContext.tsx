"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type { Workspace, RunInput, Ref } from "@/domain/types";
import { sseFrames } from "@/domain/sse";
type State = {
  selectedResumeId: string;
  data: Workspace | null;
  error: string;
  notice: string;
  busy: boolean;
  stage: string;
  runId: string | null;
  source: Ref | null;
  retry: RunInput | null;
};
type ContextValue = State & {
  startBatch: (resumeId: string) => Promise<void>;
  selectResume: (id: string) => void;
  refresh: () => Promise<void>;
  mutate: (path: string, method: string, body: unknown) => Promise<unknown>;
  run: (input: RunInput) => Promise<void>;
  cancel: () => Promise<void>;
  showSource: (ref: Ref | null) => void;
  message: (notice: string) => void;
  dismissError: () => void;
};
const Context = createContext<ContextValue | null>(null);
export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error("工作區尚未初始化。");
  return value;
}
export async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch("/api/" + path, {
    method,
    headers:
      body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.message || "操作未完成，請稍後再試。");
  return value;
}
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    (s: State, a: Partial<State>) => ({ ...s, ...a }),
    {
      selectedResumeId: "",
      data: null,
      error: "",
      notice: "",
      busy: false,
      stage: "",
      runId: null,
      source: null,
      retry: null,
    },
  );
  const controller = useRef<AbortController | null>(null);
  const activeRun = useRef<string | null>(null);
  const locked = useRef(false);
  const selectedResume = useRef("");
  const rememberResume = (id: string) => {
    selectedResume.current = id;
    // 瀏覽器只記住選擇的識別碼，不保存履歷文字或模型憑證。
    try { sessionStorage.setItem("job-matching-resume", id); } catch {}
    dispatch({ selectedResumeId: id });
  };
  const refresh = useCallback(async () => {
    const data: Workspace = await request("workspace");
    let remembered = selectedResume.current;
    if (!remembered) {
      try { remembered = sessionStorage.getItem("job-matching-resume") || ""; } catch {}
    }
    const resumes = data.documents.filter((d) => d.kind === "resume");
    const choice = resumes.find((d) => d.id === remembered)?.id || resumes[0]?.id || "";
    selectedResume.current = choice;
    try { sessionStorage.setItem("job-matching-resume", choice); } catch {}
    dispatch({ data, selectedResumeId: choice });
  }, []);
  useEffect(() => {
    refresh().catch((e) => dispatch({ error: e.message }));
  }, [refresh]);
  useEffect(() => {
    if (
      state.busy ||
      !state.data?.batches?.some((b) => b.status === "running") && !state.data?.runs.some(
        (r) => r.status === "generating" || r.status === "validating",
      )
    )
      return;
    const interval = setInterval(() => {
      refresh().catch((e) => dispatch({ error: e.message }));
    }, 2000);
    return () => clearInterval(interval);
  }, [refresh, state.busy, state.data]);
  const mutate = async (path: string, method: string, body: unknown) => {
    dispatch({ error: "" });
    try {
      const value = await request(path, method, body);
      await refresh();
      return value;
    } catch (e) {
      dispatch({ error: e instanceof Error ? e.message : "操作失敗。" });
      throw e;
    }
  };
  const run = async (input: RunInput) => {
    if (locked.current) return;
    locked.current = true;
    dispatch({
      busy: true,
      error: "",
      notice: "",
      stage: "正在準備模型請求",
      retry: input,
      runId: null,
    });
    controller.current = new AbortController();
    activeRun.current = null;
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(input),
        signal: controller.current.signal,
      });
      if (!response.ok) {
        const value = await response.json();
        throw new Error(value.message);
      }
      if (
        !response.headers.get("content-type")?.includes("text/event-stream")
      ) {
        const value = await response.json();
        if (value.error) throw new Error(value.error.message);
        dispatch({ notice: "此操作已啟動，正在查詢原執行結果。" });
      } else {
        if (!response.body) throw new Error("沒有串流回應。");
        let complete = false;
        for await (const frame of sseFrames(response.body)) {
          const event = JSON.parse(frame);
          if (event.runId) {
            activeRun.current = event.runId;
            dispatch({ runId: event.runId });
          }
          if (event.type === "started")
            dispatch({
              stage:
                event.mode === "real"
                  ? "已開始真實模型請求"
                  : "正在讀取固定合成範例",
            });
          if (event.type === "stage") dispatch({ stage: event.message });
          if (event.type === "error" || event.type === "cancelled")
            throw new Error(event.message);
          if (event.type === "completed") {
            complete = true;
            dispatch({
              notice: event.reused
                ? "沿用已驗證結果，沒有再次呼叫模型。"
                : "結果已通過格式及引用檢查。",
              retry: null,
            });
          }
        }
        if (!complete)
          throw new Error(
            "連線中斷。原執行保留在紀錄中；手動重試可能再次計費。",
          );
      }
    } catch (e) {
      dispatch({
        error: controller.current?.signal.aborted
          ? "已取消；已發生費用可能仍需支付。"
          : e instanceof Error
            ? e.message
            : "模型操作失敗。",
      });
    } finally {
      locked.current = false;
      dispatch({ busy: false, stage: "" });
      await refresh().catch(() => {});
    }
  };
  const cancel = async () => {
    const batch = state.data?.batches?.find((b) => b.status === "running");
    if (batch) {
      await request(`batches/${batch.id}/cancel`, "POST", {});
      await refresh();
    }
    if (activeRun.current)
      await request(`runs/${activeRun.current}/cancel`, "POST", {}).catch(
        () => {},
      );
    controller.current?.abort();
  };
  return (
    <Context.Provider
      value={{
        ...state,
        busy: state.busy || !!state.data?.batches?.some((b) => b.status === "running"),
        stage: state.data?.batches?.find((b) => b.status === "running")?.stage || state.stage,
        startBatch: async (resumeId) => {
          if (locked.current || state.data?.batches?.some((b) => b.status === "running")) return;
          await mutate("batches", "POST", { resumeId });
        },
        selectResume: (id) => {
          if (state.data?.documents.some((d) => d.kind === "resume" && d.id === id))
            rememberResume(id);
        },
        refresh,
        mutate,
        run,
        cancel,
        showSource: (source) => dispatch({ source }),
        message: (notice) => dispatch({ notice }),
        dismissError: () => dispatch({ error: "" }),
      }}
    >
      {children}
    </Context.Provider>
  );
}
