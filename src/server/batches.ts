import type { Batch, Document, Run, RunInput } from "@/domain/types";
import { publicError, requireCondition } from "@/domain/errors";
import { generation, get, list, put } from "./db";
import { getConfig } from "./config";
import { documentWithVersion, id, latestReview, now, operation } from "./repository";
import { cachedRunAvailable, cancelRun, claimBatch, createRun, executeRun, releaseBatch } from "./runs";
import { callWaitMs } from "./model/limiter";

const root = globalThis as typeof globalThis & { jobBatches?: Map<string, AbortController>; executingJobBatches?: Set<string> };
const controllers = (root.jobBatches ||= new Map());
const executing = (root.executingJobBatches ||= new Set<string>());
export function reconcileBatches() {
  for (const batch of list<Batch>("batches")) {
    if (batch.status === "running" && !controllers.has(batch.id))
      put("batches", { ...batch, status: "interrupted", stage: "服務重新啟動，整批分析中斷；請手動繼續，已完成結果保留。",
        jobs: batch.jobs.map((job) => job.status === "processing" ? { ...job, status: "failed", error: "服務重新啟動，未自動重新付費。" } : job) });
  }
}
export function createBatch(resumeId: string, key: string) {
  reconcileBatches();
  const config = getConfig();
  requireCondition(config.ready, "CONFIG_REQUIRED", config.reason || "模型設定未完成。", 409);
  const { document } = documentWithVersion(resumeId);
  requireCondition(document.kind === "resume", "TASK_TYPE", "請選擇履歷。", 422);
  const review = latestReview(resumeId, true);
  requireCondition(review.items.length, "FACT_REQUIRED", "請先核對至少一項履歷事實。", 409);
  const jobs = list<Document>("documents").filter((d) => d.kind === "job");
  requireCondition(jobs.length > 0 && jobs.length <= 100, "JOB_LIMIT", "整批比對需有 1–100 份職缺。", 422);
  const snapshot = { resumeId, version: document.versionId, revision: review.revision,
    jobs: jobs.map((d) => [d.id, d.versionId]), fingerprint: config.fingerprint };
  const batch = operation(key, snapshot, () => {
    const batchId = id();
    claimBatch(batchId);
    controllers.set(batchId, new AbortController());
    return put<Batch>("batches", { id: batchId, resumeId, resumeVersionId: document.versionId,
      resumeReviewRevision: review.revision, fingerprint: config.fingerprint, mode: config.mode,
      status: "running", stage: "準備比對整份職缺清單", activeRunId: null, createdAt: now(),
      jobs: jobs.map((d) => ({ jobId: d.id, versionId: d.versionId, status: "pending", error: null })) });
  });
  return get<Batch>("batches", batch.id)!;
}
export function cancelBatch(batchId: string) {
  const batch = get<Batch>("batches", batchId);
  requireCondition(batch, "NOT_FOUND", "找不到整批分析。", 404);
  controllers.get(batchId)?.abort();
  if (batch.status === "running") {
    if (batch.activeRunId && get<Run>("runs", batch.activeRunId)) cancelRun(batch.activeRunId);
    return put<Batch>("batches", { ...batch, status: "cancelled", stage: "整批分析已取消，已完成結果保留；已發生費用可能仍需支付。",
      jobs: batch.jobs.map((job) => job.status === "pending" || job.status === "processing" ? { ...job, status: "cancelled" } : job) });
  }
  return batch;
}
export function abortAllBatches() {
  for (const batchId of controllers.keys()) cancelBatch(batchId);
}

export async function executeBatch(batch: Batch) {
  const controller = controllers.get(batch.id);
  if (!controller || batch.status !== "running" || executing.has(batch.id)) return;
  executing.add(batch.id);
  const originalGeneration = generation();
  const alive = () => !controller.signal.aborted && generation() === originalGeneration && !!get<Batch>("batches", batch.id);
  const update = (changes: Partial<Batch>) => {
    if (alive()) put("batches", { ...get<Batch>("batches", batch.id)!, ...changes });
  };
  const checkResume = () => {
    const review = latestReview(batch.resumeId, true);
    requireCondition(review.versionId === batch.resumeVersionId && review.revision === batch.resumeReviewRevision && getConfig().fingerprint === batch.fingerprint,
      "VERSION_CHANGED", "履歷或模型設定已變更，請重新啟動整批比對。", 409);
  };
  const runTask = async (input: RunInput) => {
    // 每分鐘額度不足時等待，不將等待當成新的付費重試。
    let wait = getConfig().mode === "real" && !cachedRunAvailable(input) ? callWaitMs(getConfig().callsPerMinute) : 0;
    while (wait > 0 && alive()) {
      update({ stage: "等待每分鐘模型額度，之後自動繼續；可取消" });
      await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 500)));
      wait = callWaitMs(getConfig().callsPerMinute);
    }
    requireCondition(alive(), "CANCELLED", "整批分析已取消。", 409);
    checkResume();
    const run = createRun(input, id(), batch.id);
    update({ activeRunId: run.id });
    await executeRun(run, (event) => {
      const value = event as { type: string; message?: string };
      if (value.type === "stage") update({ stage: value.message || "正在分析" });
    }, controller.signal);
    const completed = get<Run>("runs", run.id);
    requireCondition(completed?.status === "completed", completed?.error?.code || "BATCH_FAILED", completed?.error?.message || "未取得有效結果。", 409);
    update({ activeRunId: null });
  };
  try {
    for (let index = 0; index < batch.jobs.length && alive(); index++) {
      checkResume();
      const jobs = get<Batch>("batches", batch.id)!.jobs;
      jobs[index] = { ...jobs[index], status: "processing", error: null };
      update({ jobs, stage: `正在比對第 ${index + 1}／${jobs.length} 份職缺` });
      try {
        const job = documentWithVersion(jobs[index].jobId).document;
        requireCondition(job.versionId === jobs[index].versionId, "VERSION_CHANGED", "職缺原文已變更，請重新啟動整批比對。", 409);
        const review = list<import("@/domain/types").Review>("reviews").filter((r) => r.documentId === job.id && r.versionId === job.versionId && r.mode === batch.mode).at(-1);
        if (!review) await runTask({ task: "parse_job", documentId: job.id });
        requireCondition(documentWithVersion(job.id).document.versionId === jobs[index].versionId, "VERSION_CHANGED", "職缺原文已變更，請重新啟動整批比對。", 409);
        await runTask({ task: "match", resumeId: batch.resumeId, jobId: job.id });
        jobs[index] = { ...jobs[index], status: "completed" };
      } catch (error) {
        jobs[index] = { ...jobs[index], status: "failed", error: publicError(error).message };
        // 憑證或履歷失效不能繼續對其餘職缺付費；單筆格式錯誤則保留失敗並繼續。
        if (["PROVIDER_AUTH", "CONFIG_REQUIRED", "VERSION_CHANGED", "REVIEW_REQUIRED"].includes(publicError(error).code)) {
          update({ jobs });
          throw error;
        }
      }
      update({ jobs });
    }
    if (alive()) update({ status: "completed", stage: "整份職缺清單已處理；失敗項目可重試，成功結果會沿用。", activeRunId: null });
  } catch (error) {
    update({ status: "interrupted", stage: publicError(error).message, activeRunId: null });
  } finally {
    controllers.delete(batch.id);
    executing.delete(batch.id);
    releaseBatch(batch.id);
  }
}
