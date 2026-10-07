import { cases } from "../tests/cases";
import { evaluateCases } from "./evaluation-core";
const live = process.argv.includes("--live");
const ids = process.argv
  .find((arg) => arg.startsWith("--cases="))
  ?.slice(8)
  .split(",");
const selected = ids
  ? cases.filter((c) => ids.includes(c.id))
  : process.argv.includes("--holdout")
    ? cases.filter((c) => c.split === "holdout")
    : cases;
await evaluateCases(
  selected,
  live,
  "grok-4.3",
  live
    ? ids
      ? "evaluation-regression"
      : "evaluation-real"
    : "evaluation-fixture",
);
