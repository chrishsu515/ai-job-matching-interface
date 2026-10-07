import { chromium } from "@playwright/test";
import fs from "node:fs";
fs.mkdirSync("docs/evidence/video-demo", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: {
    dir: "docs/evidence/video-demo",
    size: { width: 1440, height: 1000 },
  },
});
const page = await context.newPage();
const start = Date.now();
const url = "http://localhost:3001";
async function dwell(seconds: number) {
  await page.waitForTimeout(seconds * 1000);
}
try {
  await page.goto(url);
  await page.getByRole("heading", { name: "我的履歷", exact: true }).waitFor();
  await page.request.delete(url + "/api/local-data", {
    headers: { Origin: url, "Content-Type": "application/json" },
    data: { confirm: "清除", all: true },
  });
  await page.reload();
  await dwell(8);
  await page.getByRole("button", { name: "載入合成範例" }).click();
  await page.getByRole("heading", { name: "林知遠的合成履歷" }).waitFor();
  await dwell(8);
  const data = await (await page.request.get(url + "/api/workspace")).json();
  const resume = data.documents.find(
    (d: { kind: string }) => d.kind === "resume",
  );
  const job = data.documents.find(
    (d: { title: string }) => d.title === "前端工程師",
  );
  for (const doc of [resume, job]) {
    await page.goto(`${url}/review/${doc.id}`);
    if (doc.kind !== "job") await page.getByRole("button", { name: "提取履歷事實", exact: true }).click();
    await page.getByRole("button", { name: /^(確認核對內容|確認履歷並比對全部職缺)$/ }).waitFor();
    await dwell(4);
    await page
      .getByRole("button", { name: /^核對原文引用/ })
      .first()
      .click();
    await dwell(4);
    await page.getByRole("button", { name: "關閉面板" }).click();
    await page.getByRole("button", { name: /^(確認核對內容|確認履歷並比對全部職缺)$/ }).click();
    await page.getByRole("button", { name: "取消執行", exact: true }).waitFor({ state: "hidden" });
    await dwell(3);
  }
  await page.goto(url);
  const jobCard = page.locator("article").filter({ has: page.getByRole("heading", { name: "前端工程師", exact: true }) });
  await page.getByRole("button", { name: "更新全部職缺比對", exact: true }).click();
  await page.getByRole("button", { name: "取消執行", exact: true }).waitFor({ state: "hidden" });
  await jobCard.getByRole("link", { name: "查看比對結果", exact: true }).waitFor();
  await dwell(8);
  await jobCard.getByRole("link", { name: "查看比對結果", exact: true }).click();
  await page.getByText("逐項判斷已通過引用驗證", { exact: false }).waitFor();
  await dwell(12);
  await page
    .getByRole("heading", { name: "必要條件", exact: true })
    .scrollIntoViewIfNeeded();
  await dwell(12);
  await page
    .getByRole("heading", { name: "加分條件", exact: true })
    .scrollIntoViewIfNeeded();
  await dwell(15);
  await page.goto(`${url}/rewrite/${job.id}?resume=${resume.id}`);
  const version = data.versions.find(
    (v: { id: string }) => v.id === resume.versionId,
  );
  const segment = version.segments.find((s: { text: string }) =>
    s.text.includes("React Web"),
  );
  await page
    .getByLabel("選擇原始段落", { exact: false })
    .selectOption(segment.id);
  await dwell(5);
  await page.getByRole("button", { name: "產生改寫建議" }).click();
  await page.getByRole("button", { name: "接受這項改寫" }).waitFor();
  await page
    .getByRole("heading", { name: "待決定的建議" })
    .scrollIntoViewIfNeeded();
  await dwell(20);
  await page.getByRole("button", { name: "接受這項改寫" }).click();
  await dwell(7);
  await page.getByRole("button", { name: "還原至此修訂之前" }).click();
  await dwell(9);
  await page.goto(url + "/settings");
  await page.getByRole("heading", { name: "目前模式與設定" }).waitFor();
  await dwell(10);
  await page
    .getByRole("heading", { name: "清除本機資料" })
    .scrollIntoViewIfNeeded();
  await dwell(10);
  const video = page.video()!;
  await context.close();
  await video.saveAs("docs/evidence/video-demo/demo-fixture.webm");
  await video.delete();
  fs.writeFileSync(
    "docs/evidence/video-demo/metadata.json",
    JSON.stringify(
      {
        mode: "fixture",
        browser: "系統 Chrome",
        durationMs: Date.now() - start,
        voice: "無配音，旁白腳本另附",
        synthetic: true,
      },
      null,
      2,
    ),
  );
  console.log("固定範例展示錄影已保存。");
} finally {
  await browser.close();
}
