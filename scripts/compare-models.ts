import { cases } from "../tests/cases";
import { evaluateCases } from "./evaluation-core";
import fs from "node:fs";
const selected = cases.slice(0, 6);
const reports = [];
for (const model of ["grok-4.3", "grok-build-0.1"])
  reports.push(
    await evaluateCases(selected, true, model, "comparison-" + model),
  );
const costPerValid = reports.map((r) => ({
  model: r.model,
  pass: r.passed,
  samples: r.sampleCount,
  cost: r.knownBilledUsd,
  costPerValid: r.passed ? r.knownBilledUsd / r.passed : null,
  qualified: r.passed === r.sampleCount,
}));
fs.writeFileSync(
  "docs/evidence/model-comparison.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      results: costPerValid,
      decision: "必須人工核對關鍵錯誤及保留集後才能更換；預設維持 grok-4.3。",
    },
    null,
    2,
  ),
);
