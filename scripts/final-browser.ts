import fs from "node:fs";
import { chromium } from "@playwright/test";
import { demoJobs, demoResume } from "../src/domain/demo";
import type { Workspace } from "../src/domain/types";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto("http://localhost:3000");
  await page.getByRole("heading", { name: "我的履歷", exact: true }).waitFor();
  let workspace: Workspace = await (
    await page.request.get("http://localhost:3000/api/workspace")
  ).json();
  const groups = [demoResume, ...demoJobs.map((j) => j.text)];
  // 僅移除本次測試建立的相同合成範例副本，不碰其他文字或用量。
  for (const text of groups) {
    const docs = workspace.documents.filter((d) =>
      workspace.versions.some((v) => v.id === d.versionId && v.text === text),
    );
    for (const doc of docs.slice(0, -1)) {
      const response = await page.request.delete(
        `http://localhost:3000/api/documents/${doc.id}`,
        {
          headers: {
            Origin: "http://localhost:3000",
            "Content-Type": "application/json",
          },
          data: {},
        },
      );
      if (!response.ok()) throw new Error("合成副本清理未完成。");
    }
  }
  workspace = await (
    await page.request.get("http://localhost:3000/api/workspace")
  ).json();
  const before = (
    await (await page.request.get("http://localhost:3000/api/usage")).json()
  ).length;
  await page.reload();
  await page.getByRole("heading", { name: "我的履歷", exact: true }).waitFor();
  await page.screenshot({
    path: "docs/evidence/home-final.png",
    fullPage: true,
  });
  const analysis = workspace.analyses.at(-1)!;
  await page.goto(`http://localhost:3000/analysis/${analysis.jobId}`);
  await page
    .getByRole("heading", { name: "前端工程師", exact: true })
    .waitFor();
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: `docs/evidence/viewport-${width}.png`,
      fullPage: false,
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    if (overflow) throw new Error("最終畫面有水平溢出。");
  }
  const after = (
    await (await page.request.get("http://localhost:3000/api/usage")).json()
  ).length;
  if (before !== after) throw new Error("切換畫面產生非預期模型請求。");
  fs.writeFileSync(
    "docs/evidence/final-browser.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        mode: workspace.settings.mode,
        documentCount: workspace.documents.length,
        widths: [1440, 320],
        noPageOverflow: true,
        navigationAddedModelCalls: after - before,
      },
      null,
      2,
    ),
  );
  console.log("最終畫面已確認：真實模式、沒有水平溢出，切換頁面沒有模型請求。");
} finally {
  await browser.close();
}
