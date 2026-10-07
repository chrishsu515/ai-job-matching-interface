import type {
  Analysis,
  Item,
  Review,
  Rewrite,
  RunInput,
  Task,
  Version,
} from "@/domain/types";
import {
  matchSchema,
  parseSchema,
  rewriteSchema,
  verifySchema,
} from "@/domain/schemas";
import { resolveRefs } from "@/domain/sources";
import {
  matchGuard,
  rewriteIssues,
  validateItemFacts,
} from "@/domain/guardrails";
import { AppError, requireCondition } from "@/domain/errors";
import {
  currentRevision,
  documentWithVersion,
  id,
  latestReview,
  now,
} from "../repository";
import { get, list, put } from "../db";
import { getConfig } from "../config";
import { callModel, type ProviderOptions } from "./provider";
import type { Usage } from "@/domain/types";

export function taskContext(input: RunInput) {
  if (input.task.startsWith("parse_")) {
    requireCondition(input.documentId, "DOCUMENT_REQUIRED", "請選擇文件。");
    const { document, version } = documentWithVersion(input.documentId);
    requireCondition(
      (input.task === "parse_resume" && document.kind !== "job") ||
        (input.task === "parse_job" && document.kind === "job"),
      "TASK_TYPE",
      "任務與文件類型不符。",
    );
    return { version, document, versions: [version] };
  }
  requireCondition(
    input.resumeId && input.jobId,
    "PAIR_REQUIRED",
    "請選擇履歷與職缺。",
  );
  const resume = documentWithVersion(input.resumeId);
  const job = documentWithVersion(input.jobId);
  requireCondition(
    resume.document.kind === "resume" && job.document.kind === "job",
    "TASK_TYPE",
    "配對必須使用履歷與職缺。",
  );
  const resumeReview = latestReview(input.resumeId, true);
  const jobReview = latestReview(input.jobId, input.task !== "match");
  requireCondition(
    jobReview.items.length > 0 && jobReview.items.length <= 40,
    "CONDITION_LIMIT",
    "職缺須有 1–40 個具引用的條件。",
    409,
  );
  requireCondition(
    resumeReview.items.length > 0,
    "FACT_REQUIRED",
    "請保留至少一項有引用的履歷事實。",
    409,
  );
  const supplements = resumeReview.items
    .flatMap((item) =>
      item.refs.map((r) => get<Version>("versions", r.documentVersionId)),
    )
    .filter((v): v is Version => !!v);
  const versions = [
    ...new Map([resume.version, ...supplements].map((v) => [v.id, v])).values(),
  ];
  return {
    resume,
    job,
    resumeReview,
    jobReview,
    versions,
    current: currentRevision(input.resumeId),
  };
}
export function contextKey(input: RunInput) {
  const c = taskContext(input);
  if ("version" in c) return [c.version!.id, c.version!.hash];
  return [
    c.resume!.version.id,
    c.job!.version.id,
    c.resumeReview!.revision,
    c.jobReview!.revision,
    input.segmentId || null,
    input.task === "rewrite" ? c.current?.id || null : null,
  ];
}
function safeVersion(version: Version) {
  const segments = version.segments
    .filter((s) => !s.excluded)
    .map((s) => ({
      id: s.id,
      text: s.text,
    }));
  return {
    id: version.id,
    segments,
  };
}
export function previewInput(input: RunInput) {
  const c = taskContext(input);
  if ("version" in c) return { version: safeVersion(c.version!) };
  const facts = c.resumeReview!.items;
  const requirements = c.jobReview!.items;
  const evidence = c.versions.map((v) => ({
    id: v.id,
    segments: v.segments
      .filter(
        (s) =>
          !s.excluded &&
          facts.some((f) => f.refs.some((r) => r.segmentId === s.id)),
      )
      .map((s) => ({ id: s.id, text: s.text })),
  }));
  if (input.task === "match")
    return {
      facts,
      requirements,
      evidence,
      conflicts: [...c.resumeReview!.conflicts, ...c.jobReview!.conflicts],
      aliases: { JS: "JavaScript" },
    };
  const segment = c.resume!.version.segments.find(
    (s) => s.id === input.segmentId && !s.excluded,
  );
  requireCondition(
    segment && segment.text.length <= 1500,
    "SEGMENT_REQUIRED",
    "請選擇可分析且最多 1,500 字元的履歷段落。",
  );
  const currentText = c.current?.text || c.resume!.version.text;
  const position = currentText.indexOf(segment.text);
  requireCondition(
    position >= 0 && currentText.indexOf(segment.text, position + 1) < 0,
    "REWRITE_REVISION",
    "目前段落已改寫或不唯一，請先還原或選擇其他原始段落。",
    409,
  );
  return {
    before: segment.text,
    segmentId: segment.id,
    facts: facts.filter((f) => f.refs.some((r) => r.segmentId === segment.id)),
    requirements,
    evidence: [
      {
        id: c.resume!.version.id,
        segments: [{ id: segment.id, text: segment.text }],
      },
    ],
  };
}
function invalidUsage(runId: string, task: Task, error?: AppError) {
  for (const usage of list<Usage>("usage").filter(
    (u) => u.runId === runId && u.task === task && u.result === "completed",
  ))
    put("usage", {
      ...usage,
      result: "invalid",
      ...(error
        ? { validationError: { code: error.code, message: error.message } }
        : {}),
    });
}
export async function executeTask(
  input: RunInput,
  runId: string,
  options: ProviderOptions,
): Promise<Review | Analysis | Rewrite> {
  const config = options.config || getConfig();
  const c = taskContext(input);
  const payload = previewInput(input);
  try {
    if (input.task === "parse_resume" || input.task === "parse_job") {
      const output = await callModel(
        input.task,
        payload,
        parseSchema,
        runId,
        options,
      );
      options.onProgress?.("正在驗證原文引用");
      const version = c.version!;
      const items: Item[] = output.items.map((item) => ({
        ...item,
        id: id(),
        refs: resolveRefs(item.refs, [version]),
        origin: "model",
        edited: false,
      }));
      for (const item of items) {
        requireCondition(
          input.task === "parse_job"
            ? item.kind === "requirement" && item.category !== null
            : item.kind !== "requirement" && item.category === null,
          "ITEM_TYPE",
          "模型項目類型或條件分類不正確。",
          422,
        );
        validateItemFacts(item);
      }
      requireCondition(
        items.length > 0,
        "PARSE_EMPTY",
        "沒有整理出可引用項目，請補充內容或重新核對。",
        422,
      );
      return {
        id: id(),
        documentId: input.documentId!,
        versionId: version.id,
        revision: 1,
        items,
        originalItems: structuredClone(items),
        warnings: output.warnings,
        conflicts: output.conflicts.map((conflict) => ({
          ...conflict,
          refs: resolveRefs(conflict.refs, [version]),
        })),
        confirmed: false,
        mode: config.mode,
        createdAt: now(),
      };
    }
    if (input.task === "match") {
      const output = await callModel(
        "match",
        payload,
        matchSchema,
        runId,
        options,
      );
      options.onProgress?.("正在核對條件覆蓋與履歷來源");
      const requirements = c.jobReview!.items;
      requireCondition(
        output.items.length === requirements.length &&
          new Set(output.items.map((i) => i.requirementId)).size ===
            requirements.length &&
          output.items.every((i) =>
            requirements.some((r) => r.id === i.requirementId),
          ),
        "CONDITION_COVERAGE",
        "模型遺漏、重複或新增了條件，結果未採用。",
        422,
      );
      const items = output.items.map((item) => {
        const allowed = c.versions.map((v) => ({
          ...v,
          segments: v.segments.filter((s) =>
            c.resumeReview!.items.some((f) =>
              f.refs.some((r) => r.segmentId === s.id),
            ),
          ),
        }));
        const refs = resolveRefs(item.evidenceRefs, allowed);
        requireCondition(
          item.status !== "supported" || refs.length > 0,
          "MATCH_SOURCE",
          "有證據的判斷必須引用履歷。",
          422,
        );
        return matchGuard(
          requirements.find((r) => r.id === item.requirementId)!,
          { ...item, evidenceRefs: refs, excluded: false, guardrail: null },
          c.resumeReview!.items,
          c.resumeReview!.conflicts.length > 0 ||
            c.jobReview!.conflicts.length > 0,
        );
      });
      return {
        id: id(),
        resumeId: input.resumeId!,
        jobId: input.jobId!,
        resumeVersionId: c.resume!.version.id,
        jobVersionId: c.job!.version.id,
        resumeReviewRevision: c.resumeReview!.revision,
        jobReviewRevision: c.jobReview!.revision,
        items,
        mode: config.mode,
        createdAt: now(),
      };
    }
    const output = await callModel(
      "rewrite",
      payload,
      rewriteSchema,
      runId,
      options,
    );
    const segment = c.resume!.version.segments.find(
      (s) => s.id === input.segmentId,
    )!;
    const claims = output.claims.map((claim) => ({
      ...claim,
      refs: resolveRefs(claim.refs, [
        { ...c.resume!.version, segments: [segment] },
      ]),
    }));
    const issues = rewriteIssues(output.after, claims, [
      { ...c.resume!.version, segments: [segment] },
    ]);
    // 硬性檢查失敗時不再付費核查，也不開放接受。
    if (!issues.length) {
      options.onProgress?.("正在獨立核對改寫事實");
      const verified = await callModel(
        "verify",
        {
          before: segment.text,
          after: output.after,
          claims,
          evidence: [{ segmentId: segment.id, text: segment.text }],
        },
        verifySchema,
        runId,
        options,
      );
      requireCondition(
        verified.claims.length === claims.length &&
          new Set(verified.claims.map((i) => i.index)).size === claims.length &&
          verified.claims.every((i) => i.index < claims.length),
        "VERIFY_COVERAGE",
        "事實核查未完整覆蓋所有主張。",
        422,
      );
      issues.push(
        ...verified.issues,
        ...verified.claims
          .filter((i) => i.status !== "supported")
          .map((i) => i.reason),
      );
    } else invalidUsage(runId, "rewrite");
    return {
      id: id(),
      resumeId: input.resumeId!,
      jobId: input.jobId!,
      versionId: c.resume!.version.id,
      currentRevisionId: c.current?.id || null,
      resumeReviewRevision: c.resumeReview!.revision,
      jobReviewRevision: c.jobReview!.revision,
      segmentId: segment.id,
      before: segment.text,
      after: output.after,
      reason: output.reason,
      claims,
      issues: [...new Set(issues)],
      safe: issues.length === 0,
      status: "proposed",
      mode: config.mode,
      createdAt: now(),
    };
  } catch (error) {
    invalidUsage(
      runId,
      input.task,
      error instanceof AppError ? error : undefined,
    );
    if (error instanceof AppError && error.status === 422)
      error.retryable = true;
    throw error;
  }
}
