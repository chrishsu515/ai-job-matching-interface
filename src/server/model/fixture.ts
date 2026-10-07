import type { Task, Version, Item } from "@/domain/types";
import type { ParseOutput } from "@/domain/schemas";
import { AppError } from "@/domain/errors";

type Payload = {
  version?: Pick<Version, "id" | "segments">;
  facts?: Item[];
  requirements?: Item[];
  versionSegments?: Version[];
  before?: string;
  segmentId?: string;
  after?: string;
  claims?: { text: string }[];
};
export function fixtureResult(task: Task, input: unknown): unknown {
  const p = input as Payload;
  if (task === "parse_resume" || task === "parse_job") {
    const version = p.version!;
    const text = version.segments.map((s) => s.text).join("\n");
    if (!text.includes("【合成範例】") && !text.includes("【評估案例】"))
      throw new AppError(
        "FIXTURE_ONLY",
        "固定模式只提供合成範例；自己的內容請使用真實模型。",
        409,
      );
    const items: ParseOutput["items"] = [];
    for (const s of version.segments.filter((s) => !s.excluded)) {
      if (!/^[-•]\s/.test(s.text)) continue;
      const label = s.text.replace(/^[-•]\s*/, "");
      items.push({
        label,
        kind:
          task === "parse_job"
            ? "requirement"
            : /成果|降低|提升/.test(label)
              ? "achievement"
              : /任職|工程師|經歷/.test(label)
                ? "experience"
                : "skill",
        category:
          task === "parse_job"
            ? /加分/.test(label)
              ? "preferred"
              : /必要/.test(label)
                ? "required"
                : "unspecified"
            : null,
        platform: /React Native|Flutter|iOS|Android/.test(label)
          ? "mobile"
          : /React Web|Next.js|HTML|CSS/.test(label)
            ? "web"
            : "unknown",
        years: /明示\s*(\d+)\s*年/.exec(label)
          ? Number(/明示\s*(\d+)\s*年/.exec(label)![1])
          : null,
        refs: [{ segmentId: s.id, quote: s.text }],
      });
    }
    return { items, warnings: [], conflicts: [] };
  }
  if (task === "match") {
    return {
      items: p.requirements!.map((r) => {
        const skills = [
          "Next.js",
          "React Native",
          "React Web",
          "TypeScript",
          "JavaScript",
          "Firebase",
          "HTML",
          "CSS",
          "Python",
          "GraphQL",
          "Flutter",
          "iOS",
          "API",
          "JS",
        ].filter((s) => r.label.includes(s));
        const facts = p.facts!.filter((f) =>
          skills.length
            ? skills.some(
                (s) =>
                  f.label.includes(s) ||
                  (s === "JS" && f.label.includes("JavaScript")),
              )
            : /鍵盤|無障礙/.test(r.label) && /鍵盤|無障礙/.test(f.label),
        );
        const ambiguous =
          /年/.test(r.label) &&
          facts.length > 0 &&
          !facts.some((f) => f.years !== null);
        const native =
          r.label.includes("React Web") &&
          !facts.length &&
          p.facts!.some((f) => f.label.includes("React Native"));
        const status =
          facts.length && !ambiguous
            ? "supported"
            : native || ambiguous
              ? "needs_confirmation"
              : "missing_evidence";
        return {
          requirementId: r.id,
          status,
          reason:
            status === "supported"
              ? "合成履歷有對應原文證據。"
              : status === "needs_confirmation"
                ? "平台或技能期間需要進一步確認，不能直接換算。"
                : "履歷未提及這項條件，不能據此判斷不具備能力。",
          evidenceRefs: facts.flatMap((f) =>
            f.refs.map((ref) => ({
              segmentId: ref.segmentId,
              quote: ref.quote,
            })),
          ),
          clarifyingQuestion:
            status === "needs_confirmation"
              ? "是否有對應平台或明示期間的經驗？"
              : null,
          suggestedAction:
            status === "supported"
              ? null
              : "可補充具體經歷或作品，補充前不視為已有能力。",
        };
      }),
    };
  }
  if (task === "rewrite") {
    const quote = p.before!;
    const after = quote.replace(/^[-•]\s*/, "");
    return {
      after,
      reason: "移除條列符號，保留原始事實並整理為可直接使用的履歷句子。",
      claims: [{ text: after, refs: [{ segmentId: p.segmentId!, quote }] }],
    };
  }
  return {
    claims: p.claims!.map((_, index) => ({
      index,
      status: "supported",
      reason: "固定範例原句的語意沒有新增事實。",
    })),
    issues: [],
  };
}
