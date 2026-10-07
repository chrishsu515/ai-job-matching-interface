export type Mode = "fixture" | "real";
export type Task =
  "parse_resume" | "parse_job" | "match" | "rewrite" | "verify";
export type Segment = {
  id: string;
  start: number;
  end: number;
  line: number;
  text: string;
  excluded: boolean;
};
export type Version = {
  segmentationVersion?: string;
  id: string;
  documentId: string;
  text: string;
  original: string;
  hash: string;
  segments: Segment[];
  createdAt: string;
};
export type Document = {
  id: string;
  kind: "resume" | "job" | "supplement";
  title: string;
  company: string;
  location: string;
  workMode: string;
  versionId: string;
  revision: number;
  favorite: boolean;
  createdAt: string;
};
export type Ref = {
  segmentId: string;
  quote: string;
  documentVersionId: string;
  start: number;
  end: number;
};
export type Item = {
  id: string;
  label: string;
  kind: "experience" | "skill" | "achievement" | "requirement";
  category: "required" | "preferred" | "unspecified" | null;
  platform: "mobile" | "web" | "other" | "unknown";
  years: number | null;
  refs: Ref[];
  origin: "model" | "user";
  edited: boolean;
};
export type Review = {
  origin?: "model" | "user";
  id: string;
  documentId: string;
  versionId: string;
  revision: number;
  items: Item[];
  originalItems: Item[];
  warnings: string[];
  conflicts: { reason: string; refs: Ref[] }[];
  confirmed: boolean;
  mode: Mode;
  createdAt: string;
};
export type MatchStatus =
  "supported" | "missing_evidence" | "needs_confirmation";
export type MatchItem = {
  requirementId: string;
  status: MatchStatus;
  reason: string;
  evidenceRefs: Ref[];
  clarifyingQuestion: string | null;
  suggestedAction: string | null;
  excluded: boolean;
  guardrail: string | null;
};
export type Analysis = {
  id: string;
  resumeId: string;
  jobId: string;
  resumeVersionId: string;
  jobVersionId: string;
  resumeReviewRevision: number;
  jobReviewRevision: number;
  items: MatchItem[];
  mode: Mode;
  createdAt: string;
  stale?: boolean;
};
export type Rewrite = {
  id: string;
  resumeId: string;
  jobId: string;
  versionId: string;
  currentRevisionId: string | null;
  segmentId: string;
  before: string;
  after: string;
  reason: string;
  claims: { text: string; refs: Ref[] }[];
  issues: string[];
  safe: boolean;
  status: "proposed" | "accepted" | "rejected";
  mode: Mode;
  createdAt: string;
  acceptedRevisionId?: string;
  resumeReviewRevision: number;
  jobReviewRevision: number;
};
export type ResumeRevision = {
  id: string;
  documentId: string;
  sourceVersionId: string;
  previousId: string | null;
  text: string;
  rewriteId: string | null;
  restoredFromId: string | null;
  createdAt: string;
};
export type Run = {
  // 回應結構及來源驗證的實測耗時，不包含模型生成等待。
  validationMs?: number;
  id: string;
  task: Task;
  status: "generating" | "validating" | "completed" | "failed" | "cancelled";
  mode: Mode;
  requestHash: string;
  cacheKey: string;
  input: RunInput;
  result: Review | Analysis | Rewrite | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  completedAt: string | null;
  reused?: boolean;
};
export type RunInput = {
  task: Exclude<Task, "verify">;
  documentId?: string;
  resumeId?: string;
  jobId?: string;
  segmentId?: string;
};
export type Usage = {
  // 單次結構驗證耗時；舊紀錄未量測時留空。
  validationMs?: number | null;
  validationError?: { code: string; message: string } | null;
  id: string;
  runId: string;
  task: Task;
  mode: Mode;
  model: string;
  returnedModel: string | null;
  providerId: string | null;
  promptVersion: string;
  configFingerprint: string;
  attempt: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  billedTicks: string | null;
  estimatedUsd: number | null;
  durationMs: number;
  firstContentMs: number | null;
  result: "completed" | "invalid" | "failed" | "cancelled";
  prices: { input: number; cached: number; output: number };
  createdAt: string;
};
export type SettingsSummary = {
  mode: Mode;
  provider: string;
  model: string;
  ready: boolean;
  reason: string | null;
  dataDir: string;
  origin: string;
  fingerprint: string;
  prices: { input: number; cached: number; output: number };
};
export type Workspace = {
  batches?: Batch[];
  documents: Document[];
  versions: Version[];
  reviews: Review[];
  analyses: Analysis[];
  rewrites: Rewrite[];
  revisions: ResumeRevision[];
  runs: Run[];
  settings: SettingsSummary;
};
export type Batch = {
  id: string;
  resumeId: string;
  resumeVersionId: string;
  resumeReviewRevision: number;
  fingerprint: string;
  mode: Mode;
  status: "running" | "completed" | "cancelled" | "interrupted";
  jobs: { jobId: string; versionId: string; status: "pending" | "processing" | "completed" | "failed" | "cancelled"; error: string | null }[];
  stage: string;
  activeRunId: string | null;
  createdAt: string;
};
export const statusLabels: Record<MatchStatus, string> = {
  supported: "有證據",
  missing_evidence: "缺少證據",
  needs_confirmation: "需要確認",
};
export const categoryLabels = {
  required: "必要條件",
  preferred: "加分條件",
  unspecified: "未明示分類",
};
export const taskLabels: Record<Task, string> = {
  parse_resume: "整理履歷",
  parse_job: "整理職缺",
  match: "逐項配對",
  rewrite: "產生改寫",
  verify: "核對改寫事實",
};
