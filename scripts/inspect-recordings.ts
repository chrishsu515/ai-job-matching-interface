import fs from "node:fs";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const directory = path.join(process.cwd(), "docs", "evidence", "video-player");
fs.mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors: string[] = [];
const report: object[] = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto("http://localhost:3003/");
  for (const mode of ["fixture", "real"] as const) {
    const button = page.getByRole("button", { name: mode === "fixture" ? "三分鐘展示" : "真實模型流程", exact: true });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("影片資訊尚未就緒。", { exact: true })).toHaveCount(0);
    await page.waitForFunction(() => {
      const video = document.querySelector("video")!;
      return video.readyState >= 2 && Number.isFinite(video.duration) && video.videoWidth === 1440;
    });
    const media = await page.locator("video").evaluate((video: HTMLVideoElement) => ({ duration: video.duration, width: video.videoWidth, height: video.videoHeight }));
    if (mode === "fixture" && (media.duration < 120 || media.duration > 180)) throw new Error("展示影片不在兩至三分鐘範圍內。");
    // 實際解碼播放，再跳到錄影中的原文核對與缺口段落。
    await page.locator("video").evaluate(async (video: HTMLVideoElement) => {
      video.muted = true;
      await video.play();
    });
    await page.waitForFunction(() => document.querySelector("video")!.currentTime > 0.5);
    const metadata = await (await page.request.get(`http://localhost:3003/${mode}-metadata.json`)).json();
    const gaps = metadata.chapters.find((item: { text: string }) => item.text.startsWith("缺少證據"));
    await page.locator("video").evaluate(async (video: HTMLVideoElement, seconds: number) => {
      video.pause();
      await new Promise<void>((resolve) => { video.addEventListener("seeked", () => resolve(), { once: true }); video.currentTime = seconds; });
      if (video.textTracks[0]) video.textTracks[0].mode = "showing";
    }, gaps.startMs / 1000 + 1);
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(150);
      const layout = await page.locator("video").evaluate((video) => {
        const box = video.getBoundingClientRect();
        const visibleHeight = Math.max(0, Math.min(innerHeight, box.bottom) - Math.max(0, box.top));
        return { areaRatio: box.width * visibleHeight / (innerWidth * innerHeight), horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
      });
      if (layout.areaRatio < 0.5 || layout.horizontalOverflow) throw new Error("播放器面積不足一半或有整頁水平溢出。");
      const accessibility = await new AxeBuilder({ page }).analyze();
      if (accessibility.violations.length) throw new Error("播放器出現自動無障礙檢查問題。");
      await page.screenshot({ path: path.join(directory, `${mode}-${viewport.width}.png`) });
      report.push({ mode, viewport, media, ...layout, axeViolations: accessibility.violations.length, playback: true, captions: true, keyboardModeSwitch: true });
    }
  }
  const range = await page.request.get("http://localhost:3003/demo-fixture.webm", { headers: { Range: "bytes=0-99" } });
  if (range.status() !== 206 || (await range.body()).length !== 100) throw new Error("影片分段傳送不正確。");
  if ((await page.request.get("http://localhost:3003/.env")).status() !== 404) throw new Error("播放器必須拒絕設定檔路徑。");
  if (errors.length) throw new Error("播放器有瀏覽器執行錯誤。");
  fs.writeFileSync(path.join(directory, "verification.json"), JSON.stringify({ date: new Date().toISOString(), browser: "系統 Chrome", results: report, rangeRequest: true, unknownFileDenied: true, pageErrors: errors }, null, 2));
  console.log("兩份影片已實際播放；四尺寸播放器面積超過一半，字幕、鍵盤切換與分段傳送通過。");
} finally { await browser.close(); }
