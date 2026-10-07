import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { cases } from "../tests/cases";
import type { Analysis, Review, Usage } from "../src/domain/types";

const evidence = "docs/evidence";
const full = JSON.parse(
  fs.readFileSync(`${evidence}/evaluation-real.json`, "utf8"),
);
const live = JSON.parse(fs.readFileSync(`${evidence}/live-flow.json`, "utf8"));
const usage = new Map<string, Usage>();
function readDatabase(file: string) {
  if (!fs.existsSync(file)) return;
  const db = new Database(file, { readonly: true });
  try {
    for (const row of db.prepare("SELECT data FROM usage").all() as {
      data: string;
    }[]) {
      const value = JSON.parse(row.data) as Usage;
      if (value.mode === "real") usage.set(value.id, value);
    }
  } finally {
    db.close();
  }
}
readDatabase("data/workspace.sqlite");
for (const name of fs.readdirSync("data/evaluations"))
  readDatabase(
    path.join("data/evaluations", name, "database/workspace.sqlite"),
  );
// 隔離錄影也有實際費用，依請求識別碼去重後併入開發紀錄。
if (fs.existsSync("data/recordings")) {
  for (const name of fs.readdirSync("data/recordings")) {
    if (name.startsWith("real-")) readDatabase(path.join("data/recordings", name, "database/workspace.sqlite"));
  }
}
const known = [...usage.values()].filter((u) => u.billedTicks !== null);
const values = (full.usage as Usage[])
  .map((u) => u.durationMs)
  .sort((a, b) => a - b);
const median = (values: number[]) =>
  values.length % 2
    ? values[Math.floor(values.length / 2)]
    : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
const sourceChecks: { caseId: string; references: number; valid: boolean }[] =
  [];
for (const c of full.cases as {
  id: string;
  passed: boolean;
  reviews?: Review[];
  analysis?: Analysis;
}[]) {
  if (!c.reviews || !c.analysis) continue;
  const expected = cases.find((g) => g.id === c.id)!;
  const sources = new Map(
    c.reviews.map((r, i) => [
      r.versionId,
      i === 0 ? expected.resume : expected.requirement,
    ]),
  );
  const refs = [
    ...c.reviews.flatMap((r) => [
      ...r.items.flatMap((i) => i.refs),
      ...r.conflicts.flatMap((i) => i.refs),
    ]),
    ...c.analysis.items.flatMap((i) => i.evidenceRefs),
  ];
  sourceChecks.push({
    caseId: c.id,
    references: refs.length,
    valid: refs.every(
      (r) =>
        sources.get(r.documentVersionId)?.slice(r.start, r.end) === r.quote,
    ),
  });
}
const statusCounts = [
  "supported",
  "missing_evidence",
  "needs_confirmation",
].map((status) => ({
  status,
  samples: full.cases.filter((c: { expected: string }) => c.expected === status)
    .length,
  passed: full.cases.filter(
    (c: { expected: string; passed: boolean }) =>
      c.expected === status && c.passed,
  ).length,
}));
const report = {
  date: new Date().toISOString(),
  fullEvaluation: {
    samples: full.sampleCount,
    passed: full.passed,
    percentage: (full.passed / full.sampleCount) * 100,
    billedUsd: full.knownBilledUsd,
    unknownCosts: full.unknownCosts,
    requests: full.usage.length,
    requestLatency: {
      samples: values.length,
      medianMs: median(values),
      slowestMs: values.at(-1),
    },
    statusCounts,
    sourceChecks,
  },
  liveFlow: {
    tasks: live.tasks.length,
    billedUsd: live.knownBilledUsd,
    durationMs: live.durationMs,
    accepted: live.accepted,
    restored: live.restored,
  },
  batchRecording: fs.existsSync(`${evidence}/video-live/metadata.json`)
    ? JSON.parse(fs.readFileSync(`${evidence}/video-live/metadata.json`, "utf8"))
    : null,
  developmentSpending: {
    requests: usage.size,
    knownUsd: known.reduce((sum, u) => sum + Number(u.billedTicks) / 1e10, 0),
    unknownCosts: usage.size - known.length,
    byModel: [...new Set([...usage.values()].map((u) => u.model))].map(
      (model) => ({
        model,
        requests: [...usage.values()].filter((u) => u.model === model).length,
        knownUsd: known
          .filter((u) => u.model === model)
          .reduce((sum, u) => sum + Number(u.billedTicks) / 1e10, 0),
      }),
    ),
    note: "逐次識別碼去重，包含失敗及歷次回歸；未知費用未計成零。獨立端點診斷費用另列，不是帳戶帳單總額。",
  },
  limitations: [
    "首次二十四案例採當時提示版本，不將回歸替換成原始成功。",
    "僅合成單條件案例；未證明真實履歷或所有職缺的泛化品質。",
    "代理依原文核對，沒有獨立人類評審或螢幕閱讀器驗收。",
  ],
};
fs.writeFileSync(`${evidence}/metrics.json`, JSON.stringify(report, null, 2));
console.log("已整理實測費用、延遲、來源及分狀態結果；未知費用仍保持未知。");
