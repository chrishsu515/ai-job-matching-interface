import { chromium } from "@playwright/test";
import fs from "node:fs";
import { z } from "zod";
import { getConfig } from "../src/server/config";
import type { Workspace, Usage } from "../src/domain/types";
const config = getConfig();
if (config.mode !== "real") throw new Error("真實瀏覽器驗收需要真實模式。");
fs.mkdirSync("docs/evidence", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: {
    dir: "docs/evidence/video-live",
    size: { width: 1440, height: 1000 },
  },
});
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const start = Date.now();
async function data(): Promise<Workspace> {
  return (await page.request.get("http://localhost:3000/api/workspace")).json();
}
async function model(button: ReturnType<typeof page.getByRole>) {
  await button.click();
  await page
    .getByRole("button", { name: "取消執行", exact: true })
    .waitFor({ state: "visible", timeout: 10000 });
  await page
    .getByRole("button", { name: "取消執行", exact: true })
    .waitFor({ state: "hidden", timeout: 600000 });
  if (await page.locator("main [role=alert]").count())
    throw new Error(
      await page.locator("main [role=alert]").first().innerText(),
    );
}
try {
  await page.goto("http://localhost:3000");
  await page.getByRole("heading", { name: "我的履歷", exact: true }).waitFor();
  let workspace = await data();
  if (!workspace.documents.length || process.argv.includes("--fresh")) {
    await page.getByRole("button", { name: "載入合成範例" }).click();
    await page
      .getByRole("heading", { name: "林知遠的合成履歷" })
      .last()
      .waitFor();
    workspace = await data();
  }
  const resume = workspace.documents.filter((d) => d.kind === "resume").at(-1)!;
  const job = workspace.documents
    .filter((d) => d.kind === "job" && d.title === "前端工程師")
    .at(-1)!;
  const oldIds = new Set(
    (
      (await (
        await page.request.get("http://localhost:3000/api/usage")
      ).json()) as Usage[]
    ).map((u) => u.id),
  );
  for (const doc of [resume, job]) {
    const review = workspace.reviews
      .filter((r) => r.documentId === doc.id && r.mode === "real")
      .at(-1);
    await page.goto(`http://localhost:3000/review/${doc.id}`);
    await page.getByRole("heading", { name: doc.title, exact: true }).waitFor();
    if (!review)
      await model(page.getByRole("button", { name: doc.kind === "job" ? "提取職缺條件" : "提取履歷事實", exact: true }));
    const cite = page.getByRole("button", { name: /^核對原文引用/ }).first();
    await cite.click();
    await page.getByRole("dialog").waitFor();
    await page.screenshot({
      path: `docs/evidence/live-source-${doc.kind}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "關閉面板" }).click();
    await page
      .getByRole("button", { name: /^(確認核對內容|確認履歷並比對全部職缺)$/, exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "已確認核對版本" })
      .waitFor();
    await page.getByRole("button", { name: "取消執行", exact: true }).waitFor({ state: "hidden", timeout: 600000 });
    workspace = await data();
  }
  await page.goto(`http://localhost:3000/analysis/${job.id}`);
  await page.getByRole("heading", { name: job.title, exact: true }).waitFor();
  await page.getByLabel("比對的履歷").selectOption(resume.id);
  await model(
    page.getByRole("button", { name: /更新全部職缺比對|沿用／重新查詢分析/ }),
  );
  await page.screenshot({
    path: "docs/evidence/live-analysis.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "產生履歷改寫" }).click();
  await page.getByRole("heading", { name: "讓原有事實更清楚" }).waitFor();
  const sourceVersion = workspace.versions.find(
    (v) => v.id === resume.versionId,
  )!;
  const target = sourceVersion.segments.find((s) =>
    s.text.includes("React Web"),
  )!;
  await page
    .getByLabel("選擇原始段落", { exact: false })
    .selectOption(target.id);
  await model(page.getByRole("button", { name: "產生改寫建議", exact: true }));
  const accept = page
    .getByRole("button", { name: "接受這項改寫", exact: true })
    .first();
  if (!(await accept.isEnabled()))
    throw new Error(
      "改寫被事實檢查阻擋：" + (await page.locator("main").innerText()),
    );
  await page.screenshot({
    path: "docs/evidence/live-rewrite.png",
    fullPage: true,
  });
  await accept.click();
  await page
    .getByRole("heading", { name: "已接受的改寫", exact: true })
    .first()
    .waitFor();
  await page.getByRole("button", { name: "還原至此修訂之前" }).first().click();
  await page
    .getByRole("status")
    .filter({ hasText: "已建立還原版本" })
    .waitFor();
  workspace = await data();
  const current = workspace.revisions
    .filter((r) => r.documentId === resume.id)
    .at(-1)!;
  z.literal(sourceVersion.text).parse(current.text);
  await page.goto("http://localhost:3000/settings");
  await page.getByRole("heading", { name: "模型請求用量" }).waitFor();
  await page.screenshot({
    path: "docs/evidence/live-usage.png",
    fullPage: true,
  });
  const usage = (
    (await (
      await page.request.get("http://localhost:3000/api/usage")
    ).json()) as Usage[]
  ).filter((u) => !oldIds.has(u.id));
  fs.writeFileSync(
    "docs/evidence/live-flow.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: "系統 Chrome",
        durationMs: Date.now() - start,
        tasks: usage.map((u) => ({
          task: u.task,
          model: u.returnedModel,
          inputTokens: u.inputTokens,
          outputTokens: u.outputTokens,
          billedUsd:
            u.billedTicks === null ? null : Number(u.billedTicks) / 1e10,
          durationMs: u.durationMs,
        })),
        knownBilledUsd: usage.reduce(
          (sum, u) => sum + Number(u.billedTicks || 0) / 1e10,
          0,
        ),
        accepted: true,
        restored: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log("真實瀏覽器流程完成：解析、配對、改寫、接受與還原。");
} finally {
  const video = page.video();
  await context.close();
  if (video) await video.saveAs("docs/evidence/video-live/live-flow.webm");
  if (video) await video.delete();
  await browser.close();
}
