import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as config from "../src/server/config";
import {
  db,
  get,
  list,
  closeDatabases,
  clearData,
  generation,
  put,
} from "../src/server/db";
import { createDocument, operation, workspace } from "../src/server/repository";
import { contextKey, executeTask } from "../src/server/model/tasks";
import {
  updateReview,
  decideRewrite,
  restoreRevision,
  createManualReview,
  deleteDocument,
} from "../src/server/services";
import { callModel } from "../src/server/model/provider";
import { parseSchema } from "../src/domain/schemas";
import type { Review, Rewrite, Usage, Version } from "../src/domain/types";
import { resolveRefs } from "../src/domain/sources";
import { demoResume, demoJobs } from "../src/domain/demo";
import { createBatch, executeBatch, cancelBatch, reconcileBatches } from "../src/server/batches";
let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-test-"));
  const original = config.getConfig();
  vi.spyOn(config, "getConfig").mockReturnValue({
    ...original,
    mode: "fixture",
    key: "test-only",
    dataDir: directory,
    ready: true,
  });
});
it("人工核對保留非模型標示，需有效來源才可確認", () => {
  const doc = createDocument({
    kind: "resume",
    title: "合成測試",
    text: "十年 iOS 開發，沒有描述 React Web 經驗。",
    consent: true,
  });
  const manual = createManualReview(doc.id);
  expect(manual.origin).toBe("user");
  expect(manual.items).toEqual([]);
  expect(manual.confirmed).toBe(false);
  expect(createManualReview(doc.id).id).toBe(manual.id);
  expect(list("usage")).toHaveLength(0);
});
afterEach(() => {
  closeDatabases();
  vi.restoreAllMocks();
  fs.rmSync(directory, { recursive: true, force: true });
});
async function pair() {
  const resume = createDocument({
    kind: "resume",
    title: "履歷",
    text: demoResume,
    consent: true,
  });
  const job = createDocument({
    kind: "job",
    title: "職缺",
    text: demoJobs[0].text,
    consent: true,
  });
  for (const doc of [resume, job]) {
    const review = (await executeTask(
      {
        task: doc.kind === "job" ? "parse_job" : "parse_resume",
        documentId: doc.id,
      },
      "test",
      {},
    )) as Review;
    put("reviews", review);
    updateReview(review.id, {
      revision: 1,
      items: review.items,
      confirmed: true,
    });
  }
  return { resume, job };
}
describe("本機資料與完整應用流程", () => {
  it("一次整批處理所有職缺，不冒稱人工核對；再次執行沿用結果", async () => {
    const { resume } = await pair();
    for (const job of demoJobs.slice(1)) createDocument({ kind: "job", ...job, consent: true });
    const batch = createBatch(resume.id, "batch-all-first");
    await executeBatch(batch);
    expect(workspace().batches?.at(-1)?.jobs.map((j) => j.status)).toEqual(["completed", "completed", "completed"]);
    expect(workspace().analyses).toHaveLength(3);
    expect(workspace().analyses.every((a) => !a.stale)).toBe(true);
    expect(workspace().reviews.filter((r) => r.documentId !== resume.id && !r.confirmed)).toHaveLength(2);
    const calls = workspace().runs.length;
    await executeBatch(createBatch(resume.id, "batch-all-again"));
    expect(workspace().runs).toHaveLength(calls);
  });
  it("整批單一職缺失敗不阻擋其他結果，取消及重新啟動不自動付費", async () => {
    const { resume } = await pair();
    createDocument({ kind: "job", title: "不支援的固定內容", text: "一般職缺文字", consent: true });
    createDocument({ kind: "job", ...demoJobs[1], consent: true });
    await executeBatch(createBatch(resume.id, "batch-with-failure"));
    expect(workspace().batches?.at(-1)?.jobs.map((j) => j.status)).toEqual(["completed", "failed", "completed"]);
    expect(workspace().analyses).toHaveLength(2);
    const batch = createBatch(resume.id, "batch-cancel-test");
    const execution = executeBatch(batch);
    cancelBatch(batch.id);
    await execution;
    expect(workspace().batches?.at(-1)?.status).toBe("cancelled");
    const interrupted = { ...batch, id: "previous-process", status: "running" as const };
    put("batches", interrupted);
    const count = workspace().runs.length;
    reconcileBatches();
    expect(workspace().batches?.at(-1)?.status).toBe("interrupted");
    expect(workspace().runs).toHaveLength(count);
  });
  it("執行中修改履歷即停止整批，清除不讓遲到結果重建資料", async () => {
    const { resume } = await pair();
    createDocument({ kind: "job", ...demoJobs[1], consent: true });
    const batch = createBatch(resume.id, "batch-change-test");
    const execution = executeBatch(batch);
    const review = workspace().reviews.find((r) => r.documentId === resume.id)!;
    updateReview(review.id, { revision: review.revision, items: review.items, confirmed: false });
    await execution;
    expect(workspace().batches?.at(-1)?.status).toBe("interrupted");
    expect(workspace().analyses).toHaveLength(0);
    updateReview(review.id, { revision: review.revision + 1, items: review.items, confirmed: true });
    const clearing = createBatch(resume.id, "batch-clear-test");
    const clearingExecution = executeBatch(clearing);
    clearData(true);
    await clearingExecution;
    expect(workspace().documents).toHaveLength(0);
    expect(workspace().analyses).toHaveLength(0);
    expect(workspace().batches).toHaveLength(0);
  });
  it("刪除補充來源會清除依賴核對與分析，但保留履歷原文", async () => {
    const { resume, job } = await pair();
    const supplement = createDocument({
      kind: "supplement", title: "補充作品", text: "使用 Next.js 開發個人作品。", consent: true,
    });
    const version = get<Version>("versions", supplement.versionId)!;
    const review = workspace().reviews.find((r) => r.documentId === resume.id)!;
    updateReview(review.id, {
      revision: review.revision, confirmed: true,
      items: [...review.items, {
        ...review.items[0], id: "supplement-item", label: "使用 Next.js 開發個人作品",
        years: null, platform: "web", refs: resolveRefs([
          { segmentId: version.segments[0].id, quote: version.text },
        ], [version]),
      }],
    });
    const analysis = await executeTask({ task: "match", resumeId: resume.id, jobId: job.id }, "delete-test", {});
    put("analyses", analysis);
    expect(workspace().analyses).toHaveLength(1);
    deleteDocument(supplement.id);
    expect(get("documents", resume.id)).not.toBeNull();
    expect(get("versions", resume.versionId)).not.toBeNull();
    expect(get("versions", version.id)).toBeNull();
    expect(workspace().reviews.some((r) => r.documentId === resume.id)).toBe(false);
    expect(workspace().analyses).toHaveLength(0);
    await expect(executeTask({ task: "match", resumeId: resume.id, jobId: job.id }, "after-delete", {})).rejects.toThrow();
  });
  it("未確認不能分析，原文更新使分析過期", async () => {
    const { resume, job } = await pair();
    const analysis = await executeTask(
      { task: "match", resumeId: resume.id, jobId: job.id },
      "t",
      {},
    );
    put("analyses", analysis);
    createDocument(
      {
        kind: "resume",
        title: "履歷",
        text: demoResume + "\n新原文",
        consent: true,
      },
      resume.id,
      resume.revision,
    );
    expect(workspace().analyses[0].stale).toBe(true);
    await expect(
      executeTask(
        { task: "match", resumeId: resume.id, jobId: job.id },
        "t2",
        {},
      ),
    ).rejects.toThrow();
  });
  it("接受防重複、拒絕、舊版本阻擋、還原不呼叫模型", async () => {
    const { resume, job } = await pair();
    const input = {
      task: "match" as const,
      resumeId: resume.id,
      jobId: job.id,
    };
    const keyBefore = contextKey(input);
    const review = workspace().reviews.find((r) => r.documentId === job.id)!;
    expect(
      updateReview(review.id, {
        revision: review.revision,
        items: review.items,
        confirmed: true,
      }).revision,
    ).toBe(review.revision);
    const version = workspace().versions.find(
      (v) => v.id === resume.versionId,
    )!;
    const segment = version.segments.find((s) => s.text.includes("React Web"))!;
    const rewrite = (await executeTask(
      {
        task: "rewrite",
        resumeId: resume.id,
        jobId: job.id,
        segmentId: segment.id,
      },
      "t",
      {},
    )) as Rewrite;
    put("rewrites", rewrite);
    expect(rewrite.safe).toBe(true);
    const accepted = decideRewrite(
      rewrite.id,
      "accept",
      version.id,
      "accept-key",
    );
    expect(
      decideRewrite(rewrite.id, "accept", version.id, "accept-key"),
    ).toEqual(accepted);
    expect(list("revisions")).toHaveLength(1);
    const restored = restoreRevision(
      accepted.acceptedRevisionId!,
      accepted.acceptedRevisionId!,
      "restore-key",
    );
    expect(restored.text).toBe(version.text);
    expect(contextKey(input)).toEqual(keyBefore);
    expect(list("usage")).toHaveLength(0);
    const unsafe = { ...rewrite, id: "unsafe", safe: false };
    put("rewrites", unsafe);
    expect(() =>
      decideRewrite("unsafe", "accept", version.id, "unsafe-key"),
    ).toThrow();
    expect(
      decideRewrite("unsafe", "reject", version.id, "reject-key").status,
    ).toBe("rejected");
  });
  it("操作碼不能換內容，SQLite 重開保存資料", () => {
    expect(operation("operation-key", { x: 1 }, () => ({ result: 1 }))).toEqual(
      { result: 1 },
    );
    expect(() => operation("operation-key", { x: 2 }, () => 2)).toThrow();
    createDocument({
      kind: "resume",
      title: "履歷",
      text: "原文",
      consent: true,
    });
    closeDatabases();
    expect(list("documents")).toHaveLength(1);
    expect(db().pragma("secure_delete", { simple: true })).toBe(1);
  });
  it("部分與全部清除，資料世代增加", () => {
    put("usage", { id: "usage" });
    createDocument({
      kind: "resume",
      title: "履歷",
      text: "原文",
      consent: true,
    });
    const before = generation();
    clearData(false);
    expect(list("documents")).toHaveLength(0);
    expect(list("usage")).toHaveLength(1);
    expect(generation()).toBe(before + 1);
    clearData(true);
    expect(list("usage")).toHaveLength(0);
  });
  it("已計費的無效格式仍保留費用", async () => {
    const c = { ...config.getConfig(), mode: "real" as const };
    const response = {
      type: "response.completed",
      response: {
        id: "provider-test",
        model: "grok-test",
        usage: { input_tokens: 100, output_tokens: 20, cost_in_usd_ticks: 999 },
        output: [{ type: "message", content: [{ text: "{}" }] }],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("data: " + JSON.stringify(response) + "\n\n"),
        ),
    );
    await expect(
      callModel("parse_job", {}, parseSchema, "bad-result", { config: c }),
    ).rejects.toThrow();
    const usage = list<Usage>("usage")[0];
    expect(usage.billedTicks).toBe("999");
    expect(usage.result).toBe("invalid");
    vi.unstubAllGlobals();
  });
  it("清除後遲到模型回應不能復活資料", async () => {
    const c = { ...config.getConfig(), mode: "real" as const };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        clearData(true);
        return new Response(
          'data: {"type":"response.completed","response":{"usage":{"cost_in_usd_ticks":100},"output":[{"type":"message","content":[{"text":"{}"}]}]}}\n\n',
        );
      }),
    );
    await expect(
      callModel("parse_job", {}, parseSchema, "late", { config: c }),
    ).rejects.toThrow();
    expect(list("usage")).toHaveLength(0);
    vi.unstubAllGlobals();
    expect(get("runs", "late")).toBeNull();
  });
});
