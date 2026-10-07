import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../src/server/config";
import { createDocument } from "../src/server/repository";
import { closeDatabases, get, list, put } from "../src/server/db";
import { createRun, executeRun } from "../src/server/runs";
import crypto from "node:crypto";
import { callWaitMs } from "../src/server/model/limiter";
import {
  PROMPT_VERSION,
  CONTRACT_VERSION,
  VALIDATOR_VERSION,
} from "../src/server/model/prompts";
import { updateReview } from "../src/server/services";
import type {
  Analysis,
  Review,
  Usage,
  RunInput,
  Run,
} from "../src/domain/types";
import type { GoldCase } from "../tests/cases";
export async function evaluateCases(
  selected: GoldCase[],
  live: boolean,
  model: string,
  suffix: string,
) {
  const root = process.cwd();
  const original = getConfig();
  if (live && !original.key) throw new Error("真實評估缺少本機金鑰。");
  const dir = path.join(root, "data", "evaluations", suffix + "-" + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  const source = fs.readFileSync(path.join(root, ".env"), "utf8");
  let settings = source
    .replace(/^APP_MODE=.*$/m, "APP_MODE=" + (live ? "real" : "fixture"))
    .replace(/^MODEL_NAME=.*$/m, "MODEL_NAME=" + model)
    .replace(/^DATA_DIR=.*$/m, "DATA_DIR=database");
  if (model === "grok-build-0.1")
    settings = settings
      .replace(/^MODEL_INPUT_PRICE=.*$/m, "MODEL_INPUT_PRICE=1.00")
      .replace(/^MODEL_OUTPUT_PRICE=.*$/m, "MODEL_OUTPUT_PRICE=2.00");
  fs.writeFileSync(path.join(dir, ".env"), settings);
  process.chdir(dir);
  const results: unknown[] = [];
  async function call<T>(action: () => Promise<T>): Promise<T> {
    if (live) {
      const delay = callWaitMs(5);
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return action();
  }
  async function execute(input: RunInput) {
    const run = createRun(input, crypto.randomUUID());
    await executeRun(run, () => {});
    const finished = get<Run>("runs", run.id)!;
    if (finished.status !== "completed" || !finished.result)
      throw new Error(finished.error?.message || "評估沒有完整結果。");
    return finished.result;
  }
  try {
    for (const c of selected) {
      const start = Date.now();
      try {
        const resume = createDocument({
          kind: "resume",
          title: c.name,
          text: c.resume,
          consent: true,
        });
        const job = createDocument({
          kind: "job",
          title: c.name,
          text: c.requirement,
          consent: true,
        });
        const reviews: Review[] = [];
        for (const doc of [resume, job]) {
          const review = (await call(() =>
            execute({
              task: doc.kind === "job" ? "parse_job" : "parse_resume",
              documentId: doc.id,
            }),
          )) as Review;
          put("reviews", review);
          updateReview(review.id, {
            revision: review.revision,
            items: review.items,
            confirmed: true,
          });
          reviews.push(review);
        }
        const analysis = (await call(() =>
          execute({ task: "match", resumeId: resume.id, jobId: job.id }),
        )) as Analysis;
        const passed =
          analysis.items.length === 1 &&
          analysis.items[0].status === c.expected &&
          (!c.excluded || analysis.items[0].excluded);
        results.push({
          id: c.id,
          name: c.name,
          split: c.split,
          expected: c.expected,
          passed,
          durationMs: Date.now() - start,
          reviews,
          analysis,
        });
        console.log(`${c.id} ${c.name}：${passed ? "符合預期" : "未達預期"}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "評估失敗";
        results.push({
          id: c.id,
          name: c.name,
          split: c.split,
          expected: c.expected,
          passed: false,
          durationMs: Date.now() - start,
          error: message,
        });
        console.log(`${c.id}：${message}`);
      }
    }
    const usage = list<Usage>("usage");
    const report = {
      date: new Date().toISOString(),
      mode: live ? "real" : "fixture",
      model,
      promptVersion: PROMPT_VERSION,
      contractVersion: CONTRACT_VERSION,
      validatorVersion: VALIDATOR_VERSION,
      cases: results,
      sampleCount: selected.length,
      passed: results.filter((r) => (r as { passed: boolean }).passed).length,
      usage,
      knownBilledUsd: usage.reduce(
        (sum, u) => sum + Number(u.billedTicks || 0) / 1e10,
        0,
      ),
      unknownCosts: usage.filter((u) => u.billedTicks === null).length,
      manualSemanticReview: "待人工核對，不以格式通過取代語意評審",
    };
    process.chdir(root);
    fs.mkdirSync("docs/evidence/history", { recursive: true });
    fs.writeFileSync(
      `docs/evidence/history/${suffix}-${Date.now()}.json`,
      JSON.stringify(report, null, 2),
    );
    fs.writeFileSync(
      `docs/evidence/${suffix}.json`,
      JSON.stringify(report, null, 2),
    );
    return report;
  } finally {
    closeDatabases();
    process.chdir(root);
    fs.unlinkSync(path.join(dir, ".env"));
  }
}
