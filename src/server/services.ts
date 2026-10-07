import type { Document, ResumeRevision, Review, Rewrite } from "@/domain/types";
import { reviewInputSchema } from "@/domain/schemas";
import { validateResolvedRefs } from "@/domain/sources";
import { validateItemFacts } from "@/domain/guardrails";
import { requireCondition } from "@/domain/errors";
import { db, get, list, put, remove } from "./db";
import {
  currentRevision,
  documentWithVersion,
  id,
  latestReview,
  now,
  operation,
} from "./repository";
import { getConfig } from "./config";

export function createManualReview(documentId: string) {
  const { version, document } = documentWithVersion(documentId);
  const mode = getConfig().mode;
  const existing = list<Review>("reviews")
    .filter(
      (r) =>
        r.documentId === documentId &&
        r.versionId === version.id &&
        r.mode === mode,
    )
    .at(-1);
  if (existing) return existing;
  requireCondition(
    document.kind !== "supplement",
    "ITEM_TYPE",
    "補充來源請附到履歷核對項目。",
    422,
  );
  return put<Review>("reviews", {
    id: id(),
    documentId,
    versionId: version.id,
    revision: 1,
    origin: "user",
    items: [],
    originalItems: [],
    warnings: [
      "這是使用者建立的原文核對，沒有模型解析結果；每項都須自行選擇有效來源。",
    ],
    conflicts: [],
    confirmed: false,
    mode,
    createdAt: now(),
  });
}

export function updateReview(reviewId: string, value: unknown) {
  const input = reviewInputSchema.parse(value);
  const review = get<Review>("reviews", reviewId);
  requireCondition(review, "NOT_FOUND", "找不到核對紀錄。", 404);
  requireCondition(
    review.revision === input.revision &&
      documentWithVersion(review.documentId).version.id === review.versionId,
    "VERSION_CONFLICT",
    "來源或核對已變更，請重新整理。",
    409,
  );
  const allowed = [
    documentWithVersion(review.documentId).version,
    ...list<Document>("documents")
      .filter((d) => d.kind === "supplement")
      .map((d) => documentWithVersion(d.id).version),
  ];
  requireCondition(
    new Set(input.items.map((i) => i.id)).size === input.items.length,
    "DUPLICATE_ITEM",
    "核對項目不能重複。",
    422,
  );
  for (const item of input.items) {
    validateResolvedRefs(item.refs, allowed);
    validateItemFacts(item);
    requireCondition(
      documentWithVersion(review.documentId).document.kind === "job"
        ? item.kind === "requirement" && item.category !== null
        : item.kind !== "requirement" && item.category === null,
      "ITEM_TYPE",
      "核對項目類型不正確。",
      422,
    );
  }
  const items = input.items.map((item) => {
    const original = review.originalItems.find((i) => i.id === item.id);
    const edited =
      !original ||
      JSON.stringify({
        ...item,
        origin: original.origin,
        edited: original.edited,
      }) !== JSON.stringify(original);
    return {
      ...item,
      edited,
      origin: edited ? ("user" as const) : ("model" as const),
    };
  });
  const comparable = (values: typeof items) =>
    JSON.stringify(
      values.map((item) => [
        item.id,
        item.label,
        item.kind,
        item.category,
        item.platform,
        item.years,
        item.origin,
        item.edited,
        item.refs.map((ref) => [
          ref.documentVersionId,
          ref.segmentId,
          ref.start,
          ref.end,
          ref.quote,
        ]),
      ]),
    );
  if (
    review.confirmed === input.confirmed &&
    comparable(review.items) === comparable(items)
  )
    return review;
  return put("reviews", {
    ...review,
    items,
    confirmed: input.confirmed,
    revision: review.revision + 1,
  });
}
export function decideRewrite(
  rewriteId: string,
  action: "accept" | "reject",
  expectedVersion: string,
  key: string,
) {
  return operation(key, { rewriteId, action, expectedVersion }, () => {
    const rewrite = get<Rewrite>("rewrites", rewriteId);
    requireCondition(rewrite, "NOT_FOUND", "找不到改寫提案。", 404);
    requireCondition(
      rewrite.status === "proposed",
      "ALREADY_DECIDED",
      "這份提案已處理。",
      409,
    );
    requireCondition(
      rewrite.versionId === expectedVersion,
      "VERSION_CONFLICT",
      "提案版本不符。",
      409,
    );
    if (action === "reject")
      return put("rewrites", { ...rewrite, status: "rejected" });
    requireCondition(
      rewrite.safe && rewrite.issues.length === 0,
      "UNSAFE_REWRITE",
      "改寫沒有通過事實核查，不能接受。",
      422,
    );
    const { version } = documentWithVersion(rewrite.resumeId);
    const current = currentRevision(rewrite.resumeId);
    requireCondition(
      version.id === rewrite.versionId &&
        (current?.id || null) === rewrite.currentRevisionId &&
        latestReview(rewrite.resumeId, true).revision ===
          rewrite.resumeReviewRevision &&
        latestReview(rewrite.jobId, true).revision ===
          rewrite.jobReviewRevision,
      "VERSION_CONFLICT",
      "履歷或核對版本已變更，請重新產生提案。",
      409,
    );
    const segment = version.segments.find((s) => s.id === rewrite.segmentId);
    requireCondition(
      segment && segment.text === rewrite.before,
      "SOURCE_CHANGED",
      "來源段落已變更。",
      409,
    );
    const base = current?.text || version.text;
    const position = base.indexOf(rewrite.before);
    requireCondition(
      position >= 0 && base.indexOf(rewrite.before, position + 1) < 0,
      "SOURCE_CHANGED",
      "目前內容無法唯一定位原段落。",
      409,
    );
    const revision: ResumeRevision = {
      id: id(),
      documentId: rewrite.resumeId,
      sourceVersionId: version.id,
      previousId: current?.id || null,
      text:
        base.slice(0, position) +
        rewrite.after +
        base.slice(position + rewrite.before.length),
      rewriteId: rewrite.id,
      restoredFromId: null,
      createdAt: now(),
    };
    put("revisions", revision);
    return put("rewrites", {
      ...rewrite,
      status: "accepted",
      acceptedRevisionId: revision.id,
    });
  });
}
export function restoreRevision(
  revisionId: string,
  expectedCurrent: string,
  key: string,
) {
  return operation(key, { revisionId, expectedCurrent }, () => {
    const selected = get<ResumeRevision>("revisions", revisionId);
    requireCondition(selected, "NOT_FOUND", "找不到修訂版本。", 404);
    const { version } = documentWithVersion(selected.documentId);
    const current = currentRevision(selected.documentId);
    requireCondition(
      current?.id === expectedCurrent &&
        selected.sourceVersionId === version.id,
      "VERSION_CONFLICT",
      "履歷已變更，請重新整理。",
      409,
    );
    const previous = selected.previousId
      ? get<ResumeRevision>("revisions", selected.previousId)
      : null;
    const revision: ResumeRevision = {
      id: id(),
      documentId: selected.documentId,
      sourceVersionId: version.id,
      previousId: current.id,
      text: previous?.text || version.text,
      rewriteId: null,
      restoredFromId: selected.id,
      createdAt: now(),
    };
    return put("revisions", revision);
  });
}
export function deleteDocument(documentId: string) {
  documentWithVersion(documentId);
  db().transaction(() => {
    const deletedVersions = new Set(
      list<{ id: string; documentId: string }>("versions")
        .filter((v) => v.documentId === documentId)
        .map((v) => v.id),
    );
    const affectedDocuments = new Set([documentId]);
    for (const review of list<Review>("reviews")) {
      const refs = [
        ...review.items.flatMap((item) => item.refs),
        ...review.originalItems.flatMap((item) => item.refs),
        ...review.conflicts.flatMap((conflict) => conflict.refs),
      ];
      if (refs.some((ref) => deletedVersions.has(ref.documentVersionId)))
        affectedDocuments.add(review.documentId);
    }
    db().prepare("DELETE FROM operations").run();
    remove("documents", documentId);
    for (const table of ["versions", "reviews", "revisions"] as const)
      for (const record of list<{ id: string; documentId: string }>(table))
        if (
          table === "versions"
            ? record.documentId === documentId
            : affectedDocuments.has(record.documentId)
        ) remove(table, record.id);
    // 刪除依賴執行結果，不能讓舊快取復活已刪的來源。
    for (const table of ["runs", "analyses", "rewrites"] as const)
      for (const record of list<{
        id: string;
        resumeId?: string;
        jobId?: string;
        input?: { documentId?: string; resumeId?: string; jobId?: string };
      }>(table))
        if (
          [
            record.resumeId,
            record.jobId,
            record.input?.documentId,
            record.input?.resumeId,
            record.input?.jobId,
          ].some((value) => value && affectedDocuments.has(value))
        )
          remove(table, record.id);
  })();
}
