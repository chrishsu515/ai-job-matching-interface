import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as config from "../src/server/config";
import * as tasks from "../src/server/model/tasks";
import { AppError } from "../src/domain/errors";
import { reserveCall } from "../src/server/model/limiter";
import { closeDatabases, clearData, list } from "../src/server/db";
import { deleteDocument } from "../src/server/services";
import { createDocument } from "../src/server/repository";
import {
  abortAllRuns,
  cancelRun,
  createRun,
  executeRun,
  claimBatch,
  releaseBatch,
} from "../src/server/runs";
import { demoJobs } from "../src/domain/demo";
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-test-"));
  const c = config.getConfig();
  vi.spyOn(config, "getConfig").mockReturnValue({
    ...c,
    mode: "fixture",
    ready: true,
    dataDir: dir,
  });
});
it("刪除文件後遲到錯誤不能重建執行紀錄", async () => {
  const doc = createDocument({
    kind: "job",
    title: "範例",
    text: demoJobs[0].text,
    consent: true,
  });
  const run = createRun(
    { task: "parse_job", documentId: doc.id },
    "delete-operation",
  );
  const finished = executeRun(run, () => {});
  abortAllRuns();
  deleteDocument(doc.id);
  await finished;
  expect(list("runs")).toHaveLength(0);
  expect(list("reviews")).toHaveLength(0);
});
afterEach(() => {
  vi.useRealTimers();
  releaseBatch("quota-test");
  (globalThis as typeof globalThis & { modelCallTimes?: number[] }).modelCallTimes = [];
  closeDatabases();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});
it.each([false, true])("整批修復等待每分鐘額度，取消=%s 時不再送出請求", async (cancel) => {
  vi.useFakeTimers();
  const settings = config.getConfig();
  vi.mocked(config.getConfig).mockReturnValue({ ...settings, mode: "real", retries: 1, callsPerMinute: 6 });
  const document = createDocument({ kind: "job", title: "額度測試", text: demoJobs[0].text, consent: true });
  const quota = globalThis as typeof globalThis & { modelCallTimes?: number[] };
  quota.modelCallTimes = Array.from({ length: 5 }, () => Date.now());
  const execute = vi.spyOn(tasks, "executeTask").mockImplementationOnce(async () => {
    reserveCall(6);
    throw new AppError("SOURCE_INVALID", "引用未通過，需要唯一一次修復。", 422, true);
  }).mockImplementationOnce(async () => {
    reserveCall(6);
    return { id: "validated-review", documentId: document.id, versionId: document.versionId,
      revision: 1, items: [], originalItems: [], warnings: [], conflicts: [], confirmed: false, mode: "real", createdAt: new Date().toISOString() };
  });
  claimBatch("quota-test");
  const run = createRun({ task: "parse_job", documentId: document.id }, "quota-operation", "quota-test");
  const events: unknown[] = [];
  const finished = executeRun(run, (event) => events.push(event));
  await vi.advanceTimersByTimeAsync(59000);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(quota.modelCallTimes).toHaveLength(6);
  expect(events.some((event) => (event as { message?: string }).message?.includes("等待每分鐘模型額度"))).toBe(true);
  if (cancel) cancelRun(run.id);
  await vi.advanceTimersByTimeAsync(2000);
  await finished;
  expect(execute).toHaveBeenCalledTimes(cancel ? 1 : 2);
  expect((list("runs")[0] as { status: string }).status).toBe(cancel ? "cancelled" : "completed");
  expect(list("reviews")).toHaveLength(cancel ? 0 : 1);
});
it("重複操作回目前完成結果，快取不新增請求", async () => {
  const document = createDocument({
    kind: "job",
    title: "範例",
    text: demoJobs[0].text,
    consent: true,
  });
  const input = { task: "parse_job" as const, documentId: document.id };
  const run = createRun(input, "operation-run");
  await executeRun(run, () => {});
  expect(createRun(input, "operation-run").status).toBe("completed");
  expect(createRun(input, "new-operation").reused).toBe(true);
  expect(list("runs")).toHaveLength(1);
  expect(list("usage")).toHaveLength(0);
  expect(
    (list("runs")[0] as { validationMs: number }).validationMs,
  ).toBeGreaterThanOrEqual(0);
});
it("取消與清除阻止遲到執行保存", async () => {
  const doc = createDocument({
    kind: "job",
    title: "範例",
    text: demoJobs[0].text,
    consent: true,
  });
  const run = createRun(
    { task: "parse_job", documentId: doc.id },
    "cancel-operation",
  );
  const events: unknown[] = [];
  const finished = executeRun(run, (event) => events.push(event));
  cancelRun(run.id);
  clearData(true);
  await finished;
  expect(list("runs")).toHaveLength(0);
  expect(list("reviews")).toHaveLength(0);
  expect(events.some((e) => (e as { type: string }).type === "cancelled")).toBe(
    true,
  );
});
