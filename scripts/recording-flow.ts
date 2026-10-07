import fs from "node:fs";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import type { Mode, Usage, Workspace } from "../src/domain/types";
import { recordingEnvironment } from "./recording-environment";

export async function recordWorkflow(mode: Mode) {
  const directory = path.join(process.cwd(), "docs", "evidence", mode === "real" ? "video-live" : "video-demo");
  const basename = mode === "real" ? "batch-live-flow" : "demo-fixture";
  fs.mkdirSync(directory, { recursive: true });
  const environment = await recordingEnvironment(mode);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: directory, size: { width: 1440, height: 1000 } } });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const started = Date.now();
  const errors: string[] = [];
  const chapters: { startMs: number; text: string }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let success = false;
  let failure: string | null = null;
  let usage: Usage[] = [];
  let batchJobCount = 0;
  let accepted = false, restored = false, singleBatch = false;
  const chapter = (text: string) => { chapters.push({ startMs: Date.now() - started, text }); console.log("錄影階段：" + text); };
  const pause = async (seconds: number) => page.waitForTimeout(mode === "fixture" ? seconds * 1000 : 1800);
  const at = async (seconds: number) => { if (mode === "fixture") await page.waitForTimeout(Math.max(0, seconds * 1000 - (Date.now() - started))); };
  const workspace = async (): Promise<Workspace> => (await page.request.get(environment.origin + "/api/workspace")).json();
  const done = async () => {
    await expect(page.getByRole("button", { name: "取消執行", exact: true })).toBeHidden({ timeout: 600000 });
    const alerts = page.locator("main [role=alert]");
    if (await alerts.count()) throw new Error((await alerts.first().innerText()).slice(0, 300));
  };
  const rewriteQuota = async () => {
    if (mode !== "real") return;
    // 生成與獨立核查共需兩次請求；使用完成時間保守等待，不提高額度。
    for (let attempt = 0; attempt < 10; attempt++) {
      const calls: Usage[] = await (await page.request.get(environment.origin + "/api/usage")).json();
      const recent = calls.filter((item) => Date.parse(item.createdAt) > Date.now() - 61000).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      if (recent.length <= 4) return;
      chapter("整批已完成，等待本機每分鐘額度恢復後，再產生並核查改寫。");
      await page.waitForTimeout(Math.max(1000, Date.parse(recent[recent.length - 5].createdAt) + 61500 - Date.now()));
    }
    throw new Error("改寫所需額度尚未恢復，錄影停止而不自動重送。");
  };
  try {
    await page.goto(environment.origin);
    await page.getByRole("heading", { name: "我的履歷", exact: true }).waitFor();
    await expect(page.getByText(mode === "real" ? "真實 xAI 模式" : "固定範例 · 非真實 AI", { exact: true })).toBeVisible();
    chapter(mode === "real" ? "真實模型流程：使用全新合成資料，保留實際等待與費用。" : "個人本機作品：固定範例呈現操作流程，不代表真實 AI 驗收。");
    await pause(7);
    await page.getByRole("button", { name: "載入合成範例", exact: true }).click();
    await page.getByRole("heading", { name: "林知遠的合成履歷", exact: true }).waitFor();
    const initial = await workspace();
    if (initial.versions.some((version) => !version.text.includes("【合成範例】"))) throw new Error("錄影只允許合成範例。");
    const resume = initial.documents.find((document) => document.kind === "resume")!;
    chapter("上方是全部職缺共用的履歷；補充經歷與作品來源也屬於履歷。");
    await pause(6);
    await page.getByRole("button", { name: "提取履歷事實", exact: true }).click();
    await page.getByRole("link", { name: "核對履歷事實", exact: true }).waitFor();
    await page.getByRole("link", { name: "核對履歷事實", exact: true }).click();
    await page.getByRole("button", { name: "確認履歷並比對全部職缺", exact: true }).waitFor();
    chapter("只核對一次履歷：每項事實附引用，確認後自動比對全部職缺。");
    await page.getByRole("button", { name: /^核對原文引用/ }).first().click();
    await expect(page.locator("mark").first()).toBeVisible();
    await pause(5);
    await page.getByRole("button", { name: "關閉面板", exact: true }).click();
    await at(37);
    await page.getByRole("button", { name: "確認履歷並比對全部職缺", exact: true }).click();
    await page.getByRole("link", { name: "查看全部職缺結果", exact: true }).waitFor();
    await page.getByRole("link", { name: "查看全部職缺結果", exact: true }).click();
    chapter("確認一次後，系統依序提取並比對整份清單，不需逐張操作。");
    await page.getByRole("heading", { name: "一次比對，查看所有職缺結果", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(directory, "batch-progress.png") });
    await done();
    const processed = await workspace();
    const batch = processed.batches!.at(-1)!;
    batchJobCount = batch.jobs.length;
    if (processed.batches!.length !== 1 || batch.jobs.some((item) => item.status !== "completed")) throw new Error("合成職缺未在單一批次全部完成。");
    await expect(page.getByText("已完成 3／3 份", { exact: true })).toBeVisible();
    singleBatch = true;
    const results = page.getByRole("region", { name: /職缺清單/ }).getByRole("link", { name: "查看比對結果", exact: true });
    await expect(results).toHaveCount(3);
    chapter("全部職缺已出結果；每張卡片都從「查看比對結果」進入。");
    await at(56);
    await page.getByRole("region", { name: /職缺清單/ }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(directory, "all-jobs-complete.png") });
    await pause(5);
    await page.locator("article").filter({ has: page.getByRole("heading", { name: "前端工程師", exact: true }) }).getByRole("link", { name: "查看比對結果", exact: true }).click();
    await expect(page.getByText("逐項判斷已通過引用驗證", { exact: false })).toBeVisible();
    chapter("查看證據、缺口及待確認問題；職缺條件清楚標示尚未人工核對。");
    await page.getByRole("heading", { name: "必要條件", exact: true }).scrollIntoViewIfNeeded();
    await pause(7);
    await page.getByRole("button", { name: /^核對原文引用/ }).first().click();
    await expect(page.locator("mark").first()).toBeVisible();
    await page.screenshot({ path: path.join(directory, "source-check.png") });
    await pause(5);
    await page.getByRole("button", { name: "關閉面板", exact: true }).click();
    await at(84);
    await page.getByRole("heading", { name: "加分條件", exact: true }).scrollIntoViewIfNeeded();
    chapter("缺少證據只表示履歷未提及，不代表沒有能力；行動年資不折算成網頁年資。");
    await page.screenshot({ path: path.join(directory, "gaps.png") });
    await pause(8);
    await page.getByRole("link", { name: "核對職缺條件", exact: true }).click();
    await page.getByRole("button", { name: "確認核對內容", exact: true }).waitFor();
    chapter("要改寫時才核對目標職缺條件；前面的整批結果已自動產生。");
    await pause(3);
    await page.getByRole("button", { name: "確認核對內容", exact: true }).click();
    await page.getByRole("link", { name: "進入條件分析", exact: true }).click();
    await page.getByRole("link", { name: "產生履歷改寫", exact: true }).click();
    const version = initial.versions.find((value) => value.id === resume.versionId)!;
    const segment = version.segments.find((value) => value.text.includes("React Web"))!;
    await page.getByLabel("選擇原始段落", { exact: false }).selectOption(segment.id);
    await at(112);
    await rewriteQuota();
    chapter("依原始事實改寫；理由、引用及事實檢查通過後，仍需本人接受。");
    await page.getByRole("button", { name: "產生改寫建議", exact: true }).click();
    await expect.poll(async () => (await page.getByRole("button", { name: "接受這項改寫", exact: true }).count()) > 0 || (await page.locator("main [role=alert]").count()) > 0, { timeout: 180000 }).toBe(true);
    await done();
    await expect(page.getByRole("button", { name: "接受這項改寫", exact: true })).toBeEnabled();
    await page.getByRole("heading", { name: "待決定的建議", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(directory, "rewrite-check.png") });
    await pause(9);
    await at(137);
    await page.getByRole("button", { name: "接受這項改寫", exact: true }).click();
    await page.getByRole("heading", { name: "已接受的改寫", exact: true }).waitFor();
    accepted = true;
    chapter("接受後建立履歷修訂，原文證據保留，可隨時還原。");
    await page.getByRole("heading", { name: /^目前履歷/ }).scrollIntoViewIfNeeded();
    await pause(6);
    await page.getByRole("button", { name: "還原至此修訂之前", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "已建立還原版本" })).toBeVisible();
    const finalState = await workspace();
    if (finalState.revisions.filter((revision) => revision.documentId === resume.id).at(-1)?.text !== version.text) throw new Error("還原版本和原文不符。");
    restored = true;
    await page.screenshot({ path: path.join(directory, "restored.png") });
    await at(151);
    await page.getByRole("link", { name: "資料與用量", exact: true }).click();
    await page.getByRole("heading", { name: "模型請求用量", exact: true }).scrollIntoViewIfNeeded();
    chapter(mode === "real" ? "每次真實請求都有用量與實際費用紀錄，失敗亦可能計費。" : "固定範例沒有模型費用；真實模式另附完整錄影與逐次費用。");
    await page.screenshot({ path: path.join(directory, "usage.png") });
    await pause(6);
    await page.getByRole("heading", { name: "清除本機資料", exact: true }).scrollIntoViewIfNeeded();
    chapter("資料保存在本機，可主動清除；金鑰與供應商保存範圍另有說明。");
    await at(170);
    await pause(1);
    if (errors.length) throw new Error("錄影期間出現瀏覽器執行錯誤。");
    success = true;
  } catch (error) {
    failure = error instanceof Error ? error.message : "錄影未完成。";
    await page.screenshot({ path: path.join(directory, `failed-${Date.now()}.png`) }).catch(() => {});
    const state = await workspace().catch(() => null);
    // 失敗即停止正在付費的工作，不自動重跑影片或模型請求。
    for (const batch of state?.batches?.filter((value) => value.status === "running") || []) {
      await page.request.post(`${environment.origin}/api/batches/${batch.id}/cancel`, { headers: { Origin: environment.origin }, data: {} }).catch(() => {});
    }
  } finally {
    const response = await page.request.get(environment.origin + "/api/usage").catch(() => null);
    if (response?.ok()) usage = await response.json();
    const durationMs = Date.now() - started;
    const video = page.video()!;
    await context.close();
    const artifact = success ? basename : "failed-" + Date.now();
    const target = path.join(directory, `${artifact}.webm`);
    if (success && fs.existsSync(target)) {
      const previous = path.join(directory, `${basename}-before-batch-${Date.now()}.webm`);
      fs.copyFileSync(target, previous);
      const metadata = path.join(directory, "metadata.json");
      if (fs.existsSync(metadata)) fs.copyFileSync(metadata, previous.replace(/\.webm$/, ".json"));
    }
    await video.saveAs(target);
    await video.delete();
    const report = { date: new Date().toISOString(), mode, workflow: "batch-v1", artifact: path.basename(target), browser: "系統 Chrome", viewport: { width: 1440, height: 1000 }, durationMs,
      voice: success ? "無配音，附繁體中文字幕" : "無配音，失敗錄影未製作字幕", synthetic: true, isolated: true, success, failure, batchJobCount, singleBatch, accepted, restored, pageErrors: errors, chapters,
      requests: usage.length, knownBilledUsd: usage.reduce((sum, item) => sum + (item.billedTicks === null ? 0 : Number(item.billedTicks) / 1e10), 0), unknownCosts: usage.filter((item) => item.billedTicks === null).length,
      usage: usage.map((item) => ({ id: item.id, task: item.task, model: item.returnedModel || item.model, inputTokens: item.inputTokens, cachedTokens: item.cachedTokens, outputTokens: item.outputTokens, billedTicks: item.billedTicks, durationMs: item.durationMs, result: item.result })) };
    fs.writeFileSync(path.join(directory, success ? "metadata.json" : `${artifact}.json`), JSON.stringify(report, null, 2));
    if (success) {
      const timestamp = (milliseconds: number) => new Date(milliseconds).toISOString().slice(11, 23);
      fs.writeFileSync(path.join(directory, basename + ".vtt"), "WEBVTT\n\n" + chapters.map((item, index) => `${index + 1}\n${timestamp(item.startMs)} --> ${timestamp(chapters[index + 1]?.startMs || durationMs)}\n${item.text}\n`).join("\n"));
    }
    await browser.close();
    environment.stop();
    console.log(`錄影${success ? "完成" : "失敗"}：${batchJobCount} 份職缺，${usage.length} 次請求，已知費用 ${report.knownBilledUsd} 美元，未知費用 ${report.unknownCosts} 次。`);
  }
  if (!success) throw new Error(failure || "錄影未完成。");
}
