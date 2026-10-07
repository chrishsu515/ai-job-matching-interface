import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as config from "../src/server/config";
import { closeDatabases, clearData, list } from "../src/server/db";
import { deleteDocument } from "../src/server/services";
import { createDocument } from "../src/server/repository";
import {
  abortAllRuns,
  cancelRun,
  createRun,
  executeRun,
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
  closeDatabases();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
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
