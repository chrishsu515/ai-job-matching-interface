import type { Item, MatchItem, Ref, Version } from "./types";
import { requireCondition } from "./errors";
import { sensitiveCondition } from "./sources";

const technologies = [
  "React Native",
  "React Web",
  "React",
  "Next.js",
  "TypeScript",
  "JavaScript",
  "Firebase",
  "Flutter",
  "iOS",
  "Android",
  "GraphQL",
  "Python",
  "Kubernetes",
  "PostgreSQL",
  "SQLite",
  "HTML",
  "CSS",
  "API",
];
function factsTokens(text: string) {
  const numbers = text.match(/\d+(?:[.,]\d+)*(?:%|％)?/g) || [];
  const techs = technologies.filter((t) => text.includes(t));
  return [...numbers, ...techs];
}
export function unsupportedText(text: string, evidence: string): string[] {
  const issues = factsTokens(text)
    .filter((token) => !evidence.includes(token))
    .map((token) => `原文沒有「${token}」的依據。`);
  const escalations = [
    "主導",
    "精通",
    "領導",
    "獨立完成",
    "全面負責",
    "最佳",
    "首創",
    "帶領",
    "提升",
    "降低",
    "減少",
    "增加",
    "熟練",
    "專家",
    "資深",
    "首席",
    "主管",
    "架構師",
    "CTO",
    "CEO",
    "CFO",
    "總監",
    "經理",
  ];
  for (const word of escalations)
    if (text.includes(word) && !evidence.includes(word))
      issues.push(`「${word}」可能新增成果或放大責任，需補充原文。`);
  return [...new Set(issues)];
}
export function validateItemFacts(
  item: Pick<Item, "label" | "years" | "refs">,
) {
  const evidence = item.refs.map((r) => r.quote).join("\n");
  const issues = unsupportedText(item.label, evidence);
  if (item.years !== null) {
    const arabic = new RegExp(`(?:^|[^\\d])${item.years}\\s*年`);
    const chinese = [
      "零",
      "一",
      "二",
      "三",
      "四",
      "五",
      "六",
      "七",
      "八",
      "九",
      "十",
    ][item.years];
    if (
      !arabic.test(evidence) &&
      !(chinese && evidence.includes(chinese + "年"))
    )
      issues.push("年資未由引用原文明示，不能從任職日期推算。");
    const named = technologies.filter(
      (t) =>
        item.label.includes(t) &&
        !(t === "React" && /React Web|React Native/.test(item.label)),
    );
    if (
      named.length &&
      !evidence
        .split(/[。；;\n，,]/)
        .some(
          (clause) =>
            named.every((t) => clause.includes(t)) &&
            (arabic.test(clause) ||
              (!!chinese && clause.includes(chinese + "年"))),
        )
    )
      issues.push(
        "年資與這項技能沒有同段明示連結，需拆開核對，不能套用其他技能年資。",
      );
  }
  requireCondition(issues.length === 0, "FACT_INVALID", issues.join(" "), 422);
}
export function matchGuard(
  requirement: Item,
  item: MatchItem,
  facts: Item[],
  conflicts: boolean,
): MatchItem {
  const text = requirement.label.replace(/\bJS\b/g, "JavaScript");
  const cited = facts.filter((f) =>
    f.refs.some((r) =>
      item.evidenceRefs.some((e) => e.segmentId === r.segmentId),
    ),
  );
  let reason: string | null = null;
  // 只採肯定的原文子句；技術名稱出現在否定描述中不代表具備經驗。
  const positiveWeb = (quote: string) =>
    quote.split(/[，,；;。\n]/).some((clause) =>
      /React Web|React.*(?:網頁|瀏覽器)|(?:網頁|瀏覽器).*React/.test(clause) &&
      (!clause.includes("React Native") || clause.includes("React Web")) &&
      !/沒有|未使用|未曾|尚未|未提及|未描述|不具備|無.*經驗/.test(clause),
    );
  const named = technologies.filter(
    (t) =>
      text.includes(t) &&
      !(t === "React" && /React Web|React Native/.test(text)),
  );
  const related = facts.filter((f) =>
    named.some((t) =>
      f.refs.some((r) => r.quote.replace(/\bJS\b/g, "JavaScript").includes(t)),
    ),
  );
  const skillMatches = (fact: Item, technology: string) => {
    const label = fact.label.replace(/\bJS\b/g, "JavaScript");
    return (
      label.includes(technology) ||
      (technology === "React Web" &&
        fact.platform === "web" &&
        /React(?! Native)/.test(label))
    );
  };
  const sufficientYears = (values: Item[]) =>
    named.length > 0 &&
    named.every((technology) =>
      values.some(
        (f) =>
          skillMatches(f, technology) &&
          f.years !== null &&
          f.years >= requirement.years!,
      ),
    );
  if (requirement.years !== null && related.length && !sufficientYears(related))
    reason =
      "履歷提到相關技能，但技能期間未明示或不足；需確認，不能從任職日期推算。";
  if (
    /React Web/.test(text) &&
    facts.some((f) => f.refs.some((r) => /React Native/.test(r.quote))) &&
    !facts.some((f) => f.refs.some((r) => positiveWeb(r.quote)))
  )
    reason =
      "已有行動端 React Native 證據，但不能直接對應 React Web；需要確認網頁經驗。";
  if (
    /React Web/.test(text) &&
    facts.some((f) => /React/.test(f.label) && f.platform === "unknown") &&
    !facts.some((f) => /React Web/.test(f.label))
  )
    reason = "履歷提到 React，但未明示使用平台，需要確認是否為網頁經驗。";
  if (
    item.status === "supported" &&
    named.some(
      (t) =>
        !cited.some((f) =>
          f.refs.some((r) =>
            r.quote.replace(/\bJS\b/g, "JavaScript").includes(t),
          ),
        ),
    )
  )
    reason = "這項條件只有部分技術證據，需確認尚未被引用支持的部分。";
  if (sensitiveCondition(text))
    return {
      ...item,
      status: "needs_confirmation",
      excluded: true,
      reason: "此項與職務能力無關，已排除配對判斷。",
      evidenceRefs: [],
      clarifyingQuestion: null,
      suggestedAction: null,
      guardrail: "非職能條件已排除",
    };
  if (conflicts) reason = "原文存在矛盾，需核對雙方內容後再確認。";
  if (
    item.status === "supported" &&
    /React Web|網頁.*React|React.*網頁/.test(text)
  ) {
    const web = cited.some((f) => f.refs.some((r) => positiveWeb(r.quote)));
    if (!web)
      reason =
        "React Native 或平台不明的 React 經驗不能直接視為 React Web 經驗。";
    if (
      text.includes("TypeScript") &&
      !cited.some((f) =>
        f.refs.some(
          (r) =>
            /React Web|網頁|瀏覽器/.test(r.quote) &&
            r.quote.includes("TypeScript") &&
            !/沒有|未提|未描述|未使用/.test(r.quote),
        ),
      )
    )
      reason =
        "React Web 與 TypeScript 各有描述，但尚未共同明示網頁使用；需要確認 TypeScript 的網頁實作。";
  }
  if (
    item.status === "supported" &&
    text.includes("Next.js") &&
    !cited.some((f) => f.refs.some((r) => r.quote.includes("Next.js")))
  )
    reason = "React 或行動開發經驗不能直接視為 Next.js 經驗。";
  if (
    item.status === "supported" &&
    requirement.years !== null &&
    !sufficientYears(cited)
  )
    reason = "沒有明示且對應此技能的年資證據，不推算或加總任職期間。";
  if (item.status === "missing_evidence")
    item.reason =
      "履歷未提及足以支持這項條件的證據；不能據此判斷不具備能力。 " +
      item.reason.replace(
        /(?:使用者|求職者|你)(?:不具備|沒有|缺乏)[^。]*。?/g,
        "",
      );
  return reason
    ? {
        ...item,
        status: "needs_confirmation",
        reason,
        clarifyingQuestion:
          item.clarifyingQuestion || "請補充可核對的對應經驗或期間。",
        guardrail: reason,
      }
    : item;
}
export function rewriteIssues(
  after: string,
  claims: { text: string; refs: Ref[] }[],
  versions: Version[],
) {
  const issues: string[] = [];
  for (const claim of claims) {
    if (!after.includes(claim.text))
      issues.push("改寫主張未出現在建議文字中。");
    issues.push(
      ...unsupportedText(claim.text, claim.refs.map((r) => r.quote).join("\n")),
    );
  }
  const evidence = versions
    .flatMap((v) => v.segments.filter((s) => !s.excluded).map((s) => s.text))
    .join("\n");
  issues.push(...unsupportedText(after, evidence));
  // 全句必須被主張清單覆蓋，不能藏入沒有依據的尾句。
  const covered = claims.map((c) => c.text.replace(/\s/g, "")).join("");
  const sentences = after
    .split(/[。！？\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sentence of sentences)
    if (!covered.includes(sentence.replace(/\s/g, "")))
      issues.push("建議文字包含未逐項核查的句子。");
  return [...new Set(issues)];
}
