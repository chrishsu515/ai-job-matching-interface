import { chromium } from "@playwright/test";
import fs from "node:fs";
const origin = process.argv[2] || "http://localhost:3000";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
fs.mkdirSync("docs/evidence/home-workflow", { recursive: true });
try {
  await page.goto(origin);
  await page.getByRole("heading", { name: "我的履歷", exact: true }).waitFor();
  const before = await (await page.request.get(origin + "/api/workspace")).json();
  const usageBefore = await (await page.request.get(origin + "/api/usage")).json();
  const widths = [1440, 768, 390, 320];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      throw new Error("首頁有水平溢出，需調整後再交付。");
    await page.screenshot({ path: `docs/evidence/home-workflow/real-home-${width}.png`, fullPage: true });
    await page.screenshot({ path: `docs/evidence/home-workflow/real-home-${width}-viewport.png` });
  }
  const ownedSource = page.getByRole("region", { name: "我的履歷", exact: true })
    .getByRole("heading", { name: "補充經歷與作品來源", exact: true });
  if (await ownedSource.count() !== 1) throw new Error("補充來源未歸在履歷區。");
  const after = await (await page.request.get(origin + "/api/workspace")).json();
  const usageAfter = await (await page.request.get(origin + "/api/usage")).json();
  if (usageBefore.length !== usageAfter.length || before.documents.length !== after.documents.length)
    throw new Error("唯讀畫面檢查意外變更資料或新增請求。");
  fs.writeFileSync("docs/evidence/home-workflow/inspection.json", JSON.stringify({
    date: new Date().toISOString(), browser: "系統 Chrome", mode: after.settings.mode,
    widths, noPageOverflow: true, supplementWithinResume: true,
    documentCountUnchanged: true, addedModelCalls: 0, pageErrors: errors,
  }, null, 2));
  if (errors.length) throw new Error("首頁有瀏覽器執行錯誤，需修正後再交付。");
  console.log("首頁檢查通過：補充來源歸在履歷區、四尺寸無溢出、沒有新增模型請求或改動文件。");
} finally { await browser.close(); }
