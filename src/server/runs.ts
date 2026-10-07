import type { Run, RunInput } from "@/domain/types";
import { AppError, publicError, requireCondition } from "@/domain/errors";
import { get, generation, list, put } from "./db";
import { getConfig } from "./config";
import { hash, id, now, operation } from "./repository";
import { contextKey, executeTask } from "./model/tasks";
import { callWaitMs } from "./model/limiter";
import {
  CONTRACT_VERSION,
  PROMPT_VERSION,
  VALIDATOR_VERSION,
} from "./model/prompts";

type Registry = {
  batchOwner?: string | null;
  controllers: Map<string, AbortController>;
  executing: Set<string>;
  initialized: boolean;
};
const root = globalThis as typeof globalThis & { jobRuns?: Registry };
const registry = (root.jobRuns ||= {
  batchOwner: null,
  controllers: new Map(),
  executing: new Set(),
  initialized: false,
});
export function isExecuting(id: string) {
  return registry.executing.has(id);
}
export function reconcileRuns() {
  if (registry.initialized) return;
  for (const run of list<Run>("runs"))
    if (run.status === "generating" || run.status === "validating")
      put("runs", {
        ...run,
        status: "failed",
        error: {
          code: "INTERRUPTED",
          message: "服務已重新啟動，先前執行中斷；未自動重新付費。",
        },
        completedAt: now(),
      });
  registry.initialized = true;
}
export function claimBatch(owner: string) {
  requireCondition(!registry.batchOwner && registry.controllers.size === 0, "MODEL_BUSY", "另一項分析正在處理，請完成或取消後再試。", 409);
  registry.batchOwner = owner;
}
export function releaseBatch(owner: string) {
  if (registry.batchOwner === owner) registry.batchOwner = null;
}
function runCacheKey(input: RunInput) {
  const config = getConfig();
  return hash({ input, versions: contextKey(input), workspace: hash(config.dataDir),
    model: config.fingerprint, prompt: PROMPT_VERSION, contract: CONTRACT_VERSION, validator: VALIDATOR_VERSION });
}
export function cachedRunAvailable(input: RunInput) {
  const key = runCacheKey(input);
  return input.task !== "rewrite" && list<Run>("runs").some((r) => r.cacheKey === key && r.status === "completed" && Date.now() - Date.parse(r.createdAt) < 7 * 86400000);
}
export function createRun(input: RunInput, key: string, batchOwner?: string) {
  requireCondition(!registry.batchOwner || registry.batchOwner === batchOwner, "MODEL_BUSY", "正在比對整份職缺清單，請完成或取消後再試。", 409);
  reconcileRuns();
  const config = getConfig();
  requireCondition(
    config.ready,
    "CONFIG_REQUIRED",
    config.reason || "模型設定未完成。",
    409,
  );
  const cacheKey = runCacheKey(input);
  const result = operation(key, { input, cacheKey }, () => {
    const previous = list<Run>("runs")
      .filter(
        (r) =>
          r.cacheKey === cacheKey &&
          r.status === "completed" &&
          Date.now() - Date.parse(r.createdAt) < 7 * 86400000,
      )
      .at(-1);
    if (previous && input.task !== "rewrite")
      return { ...previous, reused: true };
    requireCondition(
      registry.controllers.size === 0,
      "MODEL_BUSY",
      "另一項模型任務正在處理，請完成或取消後再試。",
      409,
    );
    const run: Run = {
      id: id(),
      task: input.task,
      status: "generating",
      mode: config.mode,
      requestHash: hash(input),
      cacheKey,
      input,
      result: null,
      error: null,
      createdAt: now(),
      completedAt: null,
    };
    registry.controllers.set(run.id, new AbortController());
    return put("runs", run);
  });
  const current = get<Run>("runs", result.id);
  return current
    ? { ...current, reused: result.reused || current.status !== result.status }
    : result;
}
export function cancelRun(id: string) {
  const run = get<Run>("runs", id);
  requireCondition(run, "NOT_FOUND", "找不到執行紀錄。", 404);
  if (run.status === "generating" || run.status === "validating") {
    registry.controllers.get(id)?.abort();
    put("runs", {
      ...run,
      status: "cancelled",
      completedAt: now(),
      error: { code: "CANCELLED", message: "已取消，已發生費用可能仍需支付。" },
    });
  }
  return get<Run>("runs", id)!;
}
export function abortAllRuns() {
  for (const controller of registry.controllers.values()) controller.abort();
}
export async function executeRun(
  run: Run,
  notify: (value: unknown) => void,
  disconnect?: AbortSignal,
) {
  if (run.status === "completed") {
    notify({
      type: "completed",
      runId: run.id,
      reused: true,
      result: run.result,
    });
    return;
  }
  const controller = registry.controllers.get(run.id);
  requireCondition(
    controller,
    "RUN_ALREADY_STARTED",
    "此執行已啟動，請查詢原結果。",
    409,
  );
  requireCondition(
    !registry.executing.has(run.id),
    "RUN_ALREADY_STARTED",
    "此執行已啟動，請查詢原結果。",
    409,
  );
  registry.executing.add(run.id);
  const dataGeneration = generation();
  const unchanged = () =>
    generation() === dataGeneration && !controller.signal.aborted;
  disconnect?.addEventListener("abort", () => controller.abort(), {
    once: true,
  });
  const config = getConfig();
  notify({ type: "started", runId: run.id, mode: run.mode });
  let validationStarted: number | null = null;
  let validationDuration = 0;
  const finishValidation = () => {
    if (validationStarted !== null)
      validationDuration += performance.now() - validationStarted;
    validationStarted = null;
  };
  try {
    let result: Run["result"] = null;
    const attempts =
      run.task.startsWith("parse") || run.task === "match"
        ? 1 + config.retries
        : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        // 整批的修復也須等待同一額度；等待不增加重試次數或模型呼叫。
        if (config.mode === "real" && registry.batchOwner) {
          let announced = false;
          while (unchanged() && callWaitMs(config.callsPerMinute) > 0) {
            if (!announced) {
              notify({ type: "stage", runId: run.id, message: "等待每分鐘模型額度，之後自動繼續；可取消。" });
              announced = true;
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          requireCondition(unchanged(), "CANCELLED", "已取消或清除資料，未送出模型請求。", 409);
        }
        result = await executeTask(run.input, run.id, {
          config,
          signal: controller.signal,
          attempt,
          onProgress: (stage) => {
            if (unchanged()) {
              finishValidation();
              if (/正在驗證|正在核對/.test(stage))
                validationStarted = performance.now();
              const current = get<Run>("runs", run.id);
              if (current && /正在驗證|正在核對|正在獨立/.test(stage))
                put("runs", { ...current, status: "validating" });
              notify({ type: "stage", runId: run.id, message: stage });
            }
          },
        });
        break;
      } catch (error) {
        finishValidation();
        if (
          !(error instanceof AppError) ||
          !error.retryable ||
          attempt >= attempts ||
          controller.signal.aborted
        )
          throw error;
        notify({
          type: "stage",
          runId: run.id,
          message: "第一次未通過，正在進行唯一一次修復；可能再次計費。",
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    requireCondition(
      unchanged(),
      "CANCELLED",
      "已取消或清除資料，結果未保存。",
      409,
    );
    requireCondition(
      hash({
        input: run.input,
        versions: contextKey(run.input),
        workspace: hash(config.dataDir),
        model: config.fingerprint,
        prompt: PROMPT_VERSION,
        contract: CONTRACT_VERSION,
        validator: VALIDATOR_VERSION,
      }) === run.cacheKey,
      "VERSION_CHANGED",
      "執行期間資料已變更，結果未套用。",
      409,
    );
    requireCondition(result, "RESULT_EMPTY", "沒有完整結果。", 502);
    if (run.task.startsWith("parse")) put("reviews", result);
    else if (run.task === "match") put("analyses", result);
    else put("rewrites", result);
    finishValidation();
    put("runs", {
      ...run,
      status: "completed",
      result,
      completedAt: now(),
      validationMs: Math.round(validationDuration * 1000) / 1000,
    });
    notify({ type: "completed", runId: run.id, result, reused: false });
  } catch (error) {
    finishValidation();
    const detail = publicError(error);
    if (generation() === dataGeneration && get<Run>("runs", run.id))
      put("runs", {
        ...run,
        status: controller.signal.aborted ? "cancelled" : "failed",
        completedAt: now(),
        error: { code: detail.code, message: detail.message },
        validationMs: Math.round(validationDuration * 1000) / 1000,
      });
    notify({
      type: controller.signal.aborted ? "cancelled" : "error",
      runId: run.id,
      code: detail.code,
      message: detail.message,
    });
  } finally {
    registry.controllers.delete(run.id);
    registry.executing.delete(run.id);
  }
}
