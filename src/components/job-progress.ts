import type { Document, Workspace } from "@/domain/types";

export function documentReview(data: Workspace, document?: Document) {
  return document && data.reviews.filter((r) =>
    r.documentId === document.id && r.versionId === document.versionId &&
    r.mode === data.settings.mode,
  ).at(-1);
}

export function jobProgress(data: Workspace, job: Document, resume?: Document) {
  const resumeReview = documentReview(data, resume);
  const review = documentReview(data, job);
  const analysis = data.analyses.filter((a) =>
    a.jobId === job.id && a.resumeId === resume?.id && a.mode === data.settings.mode,
  ).at(-1);
  // 畫面也核對版本，不能把其他履歷或過期結果呈現為目前的比對。
  const stale = analysis && (analysis.stale ||
    analysis.resumeVersionId !== resume?.versionId || analysis.jobVersionId !== job.versionId ||
    analysis.resumeReviewRevision !== resumeReview?.revision || analysis.jobReviewRevision !== review?.revision);
  const step = !resume ? "no_resume" : !resumeReview ? "resume_parse" :
    !resumeReview.confirmed ? "resume_review" : !review ? "job_parse" :
    stale ? "stale" : analysis ? "complete" : !review.confirmed ? "job_review" : "match";
  return { step, analysis, review, resumeReview, stale } as const;
}
