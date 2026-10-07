import { z } from "zod";

const text = z.string().min(1).max(2048);
export const rawRefSchema = z
  .object({ segmentId: z.string().min(1), quote: text })
  .strict();
const refs = z.array(rawRefSchema).min(1).max(8);
export const parseSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            label: text,
            kind: z.enum(["experience", "skill", "achievement", "requirement"]),
            category: z
              .enum(["required", "preferred", "unspecified"])
              .nullable(),
            platform: z.enum(["mobile", "web", "other", "unknown"]),
            years: z.number().nonnegative().max(80).nullable(),
            refs,
          })
          .strict(),
      )
      .max(80),
    warnings: z.array(text).max(16),
    conflicts: z.array(z.object({ reason: text, refs }).strict()).max(16),
  })
  .strict();
export const matchSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            requirementId: z.string().min(1),
            status: z.enum([
              "supported",
              "missing_evidence",
              "needs_confirmation",
            ]),
            reason: text,
            evidenceRefs: z.array(rawRefSchema).max(8),
            clarifyingQuestion: text.nullable(),
            suggestedAction: text.nullable(),
          })
          .strict(),
      )
      .max(40),
  })
  .strict();
export const rewriteSchema = z
  .object({
    after: text,
    reason: text,
    claims: z.array(z.object({ text, refs }).strict()).min(1).max(16),
  })
  .strict();
export const verifySchema = z
  .object({
    claims: z
      .array(
        z
          .object({
            index: z.number().int().nonnegative(),
            status: z.enum(["supported", "unsupported", "uncertain"]),
            reason: text,
          })
          .strict(),
      )
      .max(16),
    issues: z.array(text).max(16),
  })
  .strict();
export const runInputSchema = z
  .object({
    task: z.enum(["parse_resume", "parse_job", "match", "rewrite"]),
    documentId: z.string().optional(),
    resumeId: z.string().optional(),
    jobId: z.string().optional(),
    segmentId: z.string().optional(),
  })
  .strict();
export const documentInputSchema = z
  .object({
    kind: z.enum(["resume", "job", "supplement"]),
    title: z.string().min(1).max(120),
    company: z.string().max(120).default(""),
    location: z.string().max(120).default(""),
    workMode: z.string().max(40).default("未提供"),
    text: z.string().min(1).max(12000),
    excludedSegmentIds: z.array(z.string()).max(100).default([]),
    consent: z.literal(true),
  })
  .strict();
export const resolvedRefSchema = rawRefSchema.extend({
  documentVersionId: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
export const itemSchema = parseSchema.shape.items.element
  .extend({
    id: z.string(),
    refs: z.array(resolvedRefSchema).min(1).max(8),
    origin: z.enum(["model", "user"]),
    edited: z.boolean(),
  })
  .strict();
export const reviewInputSchema = z
  .object({
    revision: z.number().int().positive(),
    items: z.array(itemSchema).max(80),
    confirmed: z.boolean(),
  })
  .strict();
export type RawRef = z.infer<typeof rawRefSchema>;
export type ParseOutput = z.infer<typeof parseSchema>;
export type MatchOutput = z.infer<typeof matchSchema>;
export type RewriteOutput = z.infer<typeof rewriteSchema>;
