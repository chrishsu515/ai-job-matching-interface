import crypto from "node:crypto";
import type {
  Analysis,
  Batch,
  Document,
  ResumeRevision,
  Review,
  Rewrite,
  Run,
  Usage,
  Version,
  Workspace,
} from "@/domain/types";
import { segmentText } from "@/domain/sources";
import { requireCondition } from "@/domain/errors";
import { documentInputSchema } from "@/domain/schemas";
import { getSettings, getConfig } from "./config";
import { db, get, list, put } from "./db";

export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const hash = (value: unknown) =>
  crypto
    .createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export function documentWithVersion(documentId: string) {
  const document = get<Document>("documents", documentId);
  requireCondition(document, "NOT_FOUND", "找不到文件，可能已被清除。", 404);
  const version = get<Version>("versions", document.versionId);
  requireCondition(version, "NOT_FOUND", "找不到來源版本。", 404);
  return { document, version };
}
export function createDocument(
  input: unknown,
  documentId?: string,
  revision?: number,
) {
  const value = documentInputSchema.parse(input);
  requireCondition(
    value.text.trim().length > 0,
    "EMPTY",
    "請貼上非空白內容。",
    422,
  );
  requireCondition(
    value.kind !== "job" || value.text.length <= 8000,
    "TOO_LONG",
    "職缺最多 8,000 字元。",
    413,
  );
  const previous = documentId ? documentWithVersion(documentId).document : null;
  if (previous)
    requireCondition(
      previous.revision === revision && previous.kind === value.kind,
      "VERSION_CONFLICT",
      "文件已變更，請重新核對。",
      409,
    );
  const docId = documentId || id();
  const text = value.text.replace(/\r\n?/g, "\n");
  const versionId = id();
  const segments = segmentText(text, versionId);
  // 預覽段落序號可用於初次排除，保存後使用固定識別碼。
  segments.forEach((segment, i) => {
    segment.excluded =
      value.excludedSegmentIds.includes(String(i)) ||
      value.excludedSegmentIds.includes(segment.id);
  });
  const version: Version = {
    segmentationVersion: "line-v1",
    id: versionId,
    documentId: docId,
    text,
    original: value.text,
    hash: hash({
      text,
      excluded: segments.filter((s) => s.excluded).map((s) => s.start),
    }),
    segments,
    createdAt: now(),
  };
  const document: Document = {
    id: docId,
    kind: value.kind,
    title: value.title,
    company: value.company,
    location: value.location,
    workMode: value.workMode,
    versionId,
    revision: (previous?.revision || 0) + 1,
    favorite: previous?.favorite || false,
    createdAt: previous?.createdAt || now(),
  };
  db().transaction(() => {
    put("versions", version);
    put("documents", document);
  })();
  return document;
}
export function latestReview(documentId: string, confirmed = false) {
  const { document } = documentWithVersion(documentId);
  const review = list<Review>("reviews")
    .filter(
      (r) =>
        r.documentId === documentId &&
        r.versionId === document.versionId &&
        r.mode === getConfig().mode,
    )
    .at(-1);
  requireCondition(
    review && (!confirmed || review.confirmed),
    "REVIEW_REQUIRED",
    "請先整理並確認這份文件。",
    409,
  );
  return review;
}
export function currentRevision(documentId: string) {
  const { document } = documentWithVersion(documentId);
  return (
    list<ResumeRevision>("revisions")
      .filter(
        (r) =>
          r.documentId === documentId &&
          r.sourceVersionId === document.versionId,
      )
      .at(-1) || null
  );
}
export function isAnalysisStale(analysis: Analysis) {
  try {
    const resume = latestReview(analysis.resumeId, true);
    const job = latestReview(analysis.jobId);
    return (
      resume.versionId !== analysis.resumeVersionId ||
      job.versionId !== analysis.jobVersionId ||
      resume.revision !== analysis.resumeReviewRevision ||
      job.revision !== analysis.jobReviewRevision
    );
  } catch {
    return true;
  }
}
export function workspace(): Workspace {
  return {
    batches: list<Batch>("batches"),
    documents: list<Document>("documents"),
    versions: list<Version>("versions"),
    reviews: list<Review>("reviews"),
    analyses: list<Analysis>("analyses").map((a) => ({
      ...a,
      stale: isAnalysisStale(a),
    })),
    rewrites: list<Rewrite>("rewrites"),
    revisions: list<ResumeRevision>("revisions"),
    runs: list<Run>("runs").slice(-50),
    settings: getSettings(),
  };
}
export function usageList() {
  return list<Usage>("usage");
}
export function operation<T>(
  key: string,
  payload: unknown,
  execute: () => T,
): T {
  requireCondition(
    key.length >= 8 && key.length <= 200,
    "IDEMPOTENCY_REQUIRED",
    "請提供有效的防重複操作代碼。",
    400,
  );
  return db().transaction(() => {
    const contentHash = hash(payload);
    const previous = db()
      .prepare("SELECT hash,data FROM operations WHERE id = ?")
      .get(key) as { hash: string; data: string } | undefined;
    if (previous) {
      requireCondition(
        previous.hash === contentHash,
        "IDEMPOTENCY_CONFLICT",
        "同一操作代碼不能用於不同內容。",
        409,
      );
      return JSON.parse(previous.data) as T;
    }
    const result = execute();
    db()
      .prepare("INSERT INTO operations VALUES (?,?,?)")
      .run(key, contentHash, JSON.stringify(result));
    return result;
  })();
}
