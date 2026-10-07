// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Workbench } from "../src/components/Workbench";
import type { Workspace } from "../src/domain/types";
const empty: Workspace = {
  documents: [],
  versions: [],
  reviews: [],
  analyses: [],
  rewrites: [],
  revisions: [],
  runs: [],
  settings: {
    mode: "fixture",
    provider: "xai",
    model: "grok-4.3",
    ready: true,
    reason: null,
    dataDir: "data",
    origin: "http://localhost:3000",
    fingerprint: "fixture",
    prices: { input: 1.25, cached: 0.2, output: 2.5 },
  },
};
beforeEach(() => {
  sessionStorage.clear();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
it("首頁選定履歷可延續至分析，補充來源歸在履歷區且不觸發模型", async () => {
  const document = (id: string, kind: "resume" | "job", title: string) => ({
    id, kind, title, company: "合成公司", location: "台北", workMode: "混合",
    versionId: id + "-v", revision: 1, favorite: false, createdAt: "2026-10-07",
  });
  const data = { ...empty, documents: [document("r1", "resume", "第一份合成履歷"), document("r2", "resume", "第二份合成履歷"), document("j1", "job", "合成職缺")] };
  const fetched = vi.fn().mockImplementation(async () => new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetched);
  const home = render(<Workbench view="home" />);
  await screen.findByRole("combobox", { name: "比對的履歷" });
  const resumeRegion = screen.getByRole("region", { name: "我的履歷" });
  expect(resumeRegion.contains(screen.getByRole("heading", { name: "補充經歷與作品來源" }))).toBe(true);
  fireEvent.change(screen.getByRole("combobox", { name: "比對的履歷" }), { target: { value: "r2" } });
  expect(screen.getByRole("heading", { name: "第二份合成履歷" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "第一份合成履歷" })).toBeNull();
  expect(screen.getByRole("region", { name: /職缺清單/ }).textContent).toContain("第二份合成履歷");
  home.unmount();
  render(<Workbench view="analysis" id="j1" />);
  await waitFor(() => expect((screen.getByRole("combobox", { name: "比對的履歷" }) as HTMLSelectElement).value).toBe("r2"));
  expect(fetched.mock.calls.every(([url]) => url === "/api/workspace")).toBe(true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("設定讀取前不宣稱模式，失敗保留可恢復入口", async () => {
  let reject: (value: Error) => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn().mockReturnValue(
      new Promise((_, r) => {
        reject = r;
      }),
    ),
  );
  render(<Workbench view="home" />);
  expect(screen.getByText("正在讀取設定")).toBeTruthy();
  expect(screen.queryByText("固定範例 · 非真實 AI")).toBeNull();
  reject(new Error("測試網路中斷"));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "重新讀取" })).toBeTruthy();
});
it("個資段落可在保存前排除，未同意不能當已保存", async () => {
  const requests: { path: string; body: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.body) requests.push({ path, body: String(init.body) });
      return new Response(
        JSON.stringify(path.endsWith("workspace") ? empty : { ok: true }),
        { headers: { "Content-Type": "application/json" } },
      );
    }),
  );
  render(<Workbench view="home" />);
  await screen.findByRole("heading", { name: "我的履歷" });
  fireEvent.click(screen.getByRole("button", { name: "＋ 貼上履歷" }));
  fireEvent.change(screen.getByLabelText("名稱"), {
    target: { value: "我的原文" },
  });
  fireEvent.change(screen.getByLabelText("使用者提供的原文"), {
    target: { value: "聯絡資訊\n使用 React Web" },
  });
  fireEvent.click(screen.getByLabelText("排除第 1 行：聯絡資訊"));
  fireEvent.click(screen.getByLabelText(/同意保存在本機資料庫/));
  fireEvent.submit(
    screen.getByRole("button", { name: "保存原文" }).closest("form")!,
  );
  await waitFor(() => expect(requests.length).toBe(1));
  const saved = JSON.parse(requests[0].body);
  expect(saved.excludedSegmentIds).toEqual(["0"]);
  expect(saved.consent).toBe(true);
  expect(localStorage.length).toBe(0);
});
