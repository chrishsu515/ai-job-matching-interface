import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
const directory = "docs/evidence/batch-workflow";
fs.mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ baseURL: "http://localhost:3000", viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto("http://localhost:3000");
  await page.getByRole("heading", { name: "我的履歷", exact: true }).waitFor();
  const before = await (await page.request.get("/api/workspace")).json();
  const usageBefore = await (await page.request.get("/api/usage")).json();
  if (before.settings.mode !== "real" || before.versions.some((v: { text: string }) => !v.text.includes("【合成範例】")))
    throw new Error("真實整批驗收僅使用既有合成資料，不處理未授權的其他內容。");
  const started = Date.now();
  await page.getByRole("button", { name: /^(更新全部職缺比對|比對全部職缺)$/ }).click();
  await expect(page.getByRole("button", { name: "取消執行", exact: true })).toBeVisible();
  await page.screenshot({ path: `${directory}/real-processing.png`, fullPage: true });
  await page.reload();
  await page.getByRole("heading", { name: "我的履歷", exact: true }).waitFor();
  await expect(page.getByRole("button", { name: "取消執行", exact: true })).toBeHidden({ timeout: 600000 });
  const after = await (await page.request.get("/api/workspace")).json();
  const added = (await (await page.request.get("/api/usage")).json()).filter((u: { id: string }) => !usageBefore.some((old: { id: string }) => old.id === u.id));
  const batch = after.batches.at(-1);
  const report = { date: new Date().toISOString(), browser: "系統 Chrome", mode: after.settings.mode,
    durationMs: Date.now() - started, jobCount: batch.jobs.length,
    results: batch.jobs.map((j: { status: string; error: string | null }) => ({ status: j.status, error: j.error })),
    newRequests: added.length, billedUsd: added.reduce((sum: number, u: { billedTicks: string | null }) => sum + (u.billedTicks === null ? 0 : Number(u.billedTicks) / 1e10), 0),
    unknownCostCount: added.filter((u: { billedTicks: string | null }) => u.billedTicks === null).length,
    usage: added.map((u: { id: string; model: string; inputTokens: number; outputTokens: number; billedTicks: string; result: string }) => ({ id: u.id, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, billedTicks: u.billedTicks, result: u.result })),
    documentCountUnchanged: before.documents.length === after.documents.length, pageErrors: errors,
    reloadDidNotRestartBatch: after.batches.length === (before.batches?.length || 0) + 1 };
  fs.writeFileSync(`${directory}/real-report.json`, JSON.stringify(report, null, 2));
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) throw new Error("畫面水平溢出。");
    await page.screenshot({ path: `${directory}/real-complete-${width}.png`, fullPage: true });
    await page.getByRole("region", { name: "一次比對，查看所有職缺結果", exact: true }).screenshot({ path: `${directory}/real-panel-${width}.png` });
  }
  await page.getByRole("region", { name: /職缺清單/ }).getByRole("link", { name: "查看比對結果", exact: true }).first().click();
  await expect(page.getByText("逐項判斷已通過引用驗證", { exact: false })).toBeVisible();
  await page.screenshot({ path: `${directory}/real-result.png`, fullPage: true });
  if (errors.length || !report.documentCountUnchanged || !report.reloadDidNotRestartBatch) throw new Error("整批驗收發現介面錯誤或資料變動。");
  console.log(`真實整批驗收：${report.jobCount} 份職缺，${batch.jobs.filter((j: { status: string }) => j.status === "completed").length} 份完成，新增 ${added.length} 次請求，已知費用 ${report.billedUsd} 美元，未知費用 ${report.unknownCostCount} 次。`);
} finally { await browser.close(); }
