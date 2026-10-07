import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
fs.mkdirSync("docs/evidence/browser", { recursive: true });
test("模型無法解析時人工核對須有來源，且不冒充模型成功", async ({ page }) => {
  await setup(page);
  const workspace = await (await page.request.get("/api/workspace")).json();
  const resume = workspace.documents.find(
    (d: { kind: string }) => d.kind === "resume",
  );
  await page.goto(`/review/${resume.id}`);
  await page
    .getByRole("button", { name: "自行核對原文（不呼叫模型）", exact: true })
    .click();
  await expect(
    page.getByText("使用者自行核對 · 非模型解析", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^(確認核對內容|確認履歷並比對全部職缺)$/ }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "新增有來源項目", exact: true })
    .click();
  await page.getByLabel("項目文字", { exact: true }).fill("iOS 開發");
  await page
    .getByRole("combobox", { name: "平台", exact: true })
    .selectOption("mobile");
  await page.getByRole("checkbox", { name: /2014–2020/ }).check();
  await page
    .getByRole("button", { name: "套用到核對草稿", exact: true })
    .click();
  await page.getByRole("button", { name: /^(確認核對內容|確認履歷並比對全部職缺)$/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已確認核對版本" }),
  ).toBeVisible();
  expect((await (await page.request.get("/api/usage")).json()).length).toBe(0);
  await page.screenshot({
    path: "docs/evidence/browser/manual-recovery.png",
    fullPage: true,
  });
});
test("鍵盤依序完成整理、核對、引用、配對、接受與還原", async ({ page }) => {
  await setup(page, false);
  async function enter(
    name: string | RegExp,
    role: "button" | "link" = "button",
  ) {
    const button = page
      .getByRole(role, { name, exact: typeof name === "string" })
      .first();
    await expect(button).toBeEnabled();
    for (let i = 0; i < 180; i++) {
      if (await button.evaluate((node) => node === document.activeElement)) {
        await page.keyboard.press("Enter");
        return;
      }
      await page.keyboard.press("Tab");
    }
    throw new Error("鍵盤無法依序到達操作目標。");
  }
  await enter("載入合成範例");
  await expect(
    page.getByRole("heading", { name: "林知遠的合成履歷", exact: true }),
  ).toBeVisible();
  await enter("提取履歷事實");
  await expect(page.getByRole("link", { name: "核對履歷事實", exact: true })).toBeVisible();
  await enter("核對履歷事實", "link");
  await enter(/^核對原文引用/);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await enter("確認履歷並比對全部職缺");
  await expect(page.getByRole("button", { name: "取消執行", exact: true })).toBeHidden();
  await enter("查看全部職缺結果", "link");
  await expect(page.getByText("已完成 3／3 份", { exact: true })).toBeVisible();
  await enter("查看比對結果", "link");
  await expect(page.getByText("逐項判斷已通過引用驗證", { exact: false })).toBeVisible();
  await enter("核對職缺條件", "link");
  await enter("確認核對內容");
  await enter("進入條件分析", "link");
  await enter("更新全部職缺比對");
  await expect(page.getByText("逐項判斷已通過引用驗證", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消執行", exact: true })).toBeHidden();
  await enter("產生履歷改寫", "link");
  await enter("產生改寫建議");
  await expect(
    page.getByRole("button", { name: "接受這項改寫" }),
  ).toBeEnabled();
  await enter("接受這項改寫");
  await expect(
    page.getByRole("heading", { name: "已接受的改寫" }),
  ).toBeVisible();
  await enter("還原至此修訂之前");
  await expect(
    page.getByRole("status").filter({ hasText: "已建立還原版本" }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/evidence/browser/keyboard-complete.png",
    fullPage: true,
  });
});
async function setup(page: Page, seed = true) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "我的履歷", exact: true })).toBeVisible();
  await page.request.delete("/api/local-data", {
    headers: {
      Origin: "http://localhost:3001",
      "Content-Type": "application/json",
    },
    data: { confirm: "清除", all: true },
  });
  await page.reload();
  if (seed) {
    await page.getByRole("button", { name: "載入合成範例" }).click();
    await expect(
      page.getByRole("heading", { name: "林知遠的合成履歷" }),
    ).toBeVisible();
  }
}
async function complete(page: Page) {
  await expect(
    page.getByRole("button", { name: "取消執行", exact: true }),
  ).toBeHidden();
  await expect(page.locator("main [role=alert]")).toHaveCount(0);
}
async function arrangePair(page: Page) {
  const w = await (await page.request.get("/api/workspace")).json();
  const resume = w.documents.find((d: { kind: string }) => d.kind === "resume");
  const job = w.documents.find(
    (d: { title: string }) => d.title === "前端工程師",
  );
  for (const doc of [resume, job]) {
    await page.goto(`/review/${doc.id}`);
    await page.getByRole("button", { name: doc.kind === "job" ? "提取職缺條件" : "提取履歷事實", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /^(確認核對內容|確認履歷並比對全部職缺)$/ }),
    ).toBeVisible();
    await complete(page);
    const parsed = await (await page.request.get("/api/workspace")).json();
    const review = parsed.reviews.find((r: { documentId: string }) => r.documentId === doc.id);
    await page.request.put(`/api/reviews/${review.id}`, {
      headers: { Origin: "http://localhost:3001" },
      data: { revision: review.revision, items: review.items, confirmed: true },
    });
    await page.reload();
    await expect(page.getByText("已確認的核對版本", { exact: false })).toBeVisible();
  }
  return { resume, job };
}
test("固定範例完整流程、引用焦點、修正、接受拒絕還原、重用", async ({
  page,
}) => {
  await setup(page);
  const { resume, job } = await arrangePair(page);
  const citation = page.getByRole("button", { name: /^核對原文引用/ }).first();
  await citation.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("mark")).not.toBeEmpty();
  await page.keyboard.press("Escape");
  await expect(citation).toBeFocused();
  await page.getByRole("button", { name: "修正項目 1", exact: true }).click();
  await page.getByLabel("項目文字").fill("必要：具有 React Web 開發經驗。");
  await page.getByRole("button", { name: "套用到核對草稿" }).click();
  await page.getByRole("button", { name: /^(確認核對內容|確認履歷並比對全部職缺)$/ }).click();
  await expect(
    page.getByText("使用者修正", { exact: false }).first(),
  ).toBeVisible();
  await page.goto(`/analysis/${job.id}`);
  await page.getByRole("button", { name: "更新全部職缺比對", exact: true }).click();
  await expect(
    page.getByText("逐項判斷已通過引用驗證", { exact: false }),
  ).toBeVisible();
  await complete(page);
  await page.getByRole("button", { name: "沿用／重新查詢分析" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "沿用已驗證" }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/evidence/browser/analysis-fixture.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "產生履歷改寫" }).click();
  await page.getByRole("button", { name: "產生改寫建議" }).click();
  await expect(
    page.getByRole("button", { name: "接受這項改寫" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "拒絕提案" }).click();
  await expect(
    page.getByRole("heading", { name: "已拒絕的提案" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "產生改寫建議" }).click();
  await expect(
    page.getByRole("button", { name: "接受這項改寫" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "接受這項改寫" }).click();
  await expect(
    page.getByRole("heading", { name: "已接受的改寫" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "還原至此修訂之前" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已建立還原版本" }),
  ).toBeVisible();
  const w = await (await page.request.get("/api/workspace")).json();
  expect(w.revisions.at(-1).text).toBe(
    w.versions.find((v: { id: string }) => v.id === resume.versionId).text,
  );
  const matchesBefore = w.runs.filter(
    (r: { task: string }) => r.task === "match",
  ).length;
  await page.goto(`/review/${job.id}`);
  await page.getByRole("button", { name: /^(確認核對內容|確認履歷並比對全部職缺)$/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已確認核對版本" }),
  ).toBeVisible();
  await page.goto(`/analysis/${job.id}`);
  await page
    .getByRole("button", { name: "沿用／重新查詢分析", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "沿用已驗證" }),
  ).toBeVisible();
  const afterRestore = await (await page.request.get("/api/workspace")).json();
  expect(
    afterRestore.runs.filter((r: { task: string }) => r.task === "match")
      .length,
  ).toBe(matchesBefore);
  expect((await (await page.request.get("/api/usage")).json()).length).toBe(0);
});
test("搜尋篩選收藏與三職缺比較", async ({ page }) => {
  await setup(page);
  await page.getByLabel("搜尋", { exact: true }).fill("GraphQL");
  await expect(
    page.getByRole("heading", { name: "資深網頁前端工程師" }),
  ).toBeVisible();
  await page.getByLabel("搜尋", { exact: true }).fill("沒有結果");
  await expect(
    page.getByRole("heading", { name: "沒有符合篩選的職缺" }),
  ).toBeVisible();
  await page.getByLabel("搜尋", { exact: true }).fill("");
  await page
    .getByRole("button", { name: "收藏 前端工程師", exact: true })
    .click();
  await page.getByLabel("僅收藏").check();
  await expect(
    page.getByRole("heading", { name: "全端工程師", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "取消收藏 前端工程師", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "職缺比較", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "比較職缺的要求與證據" }),
  ).toBeVisible();
  const checks = page.getByRole("checkbox");
  await expect(checks).toHaveCount(3);
  await checks.nth(0).check();
  await checks.nth(1).check();
  await checks.nth(2).check();
  await expect(page.getByText("選擇職缺（3／3）")).toBeVisible();
  await expect(page.getByText("尚未整理，不視為不符合。")).toHaveCount(3);
});
test("核對一次履歷即比對全部職缺、統一入口、重新整理與重用及履歷隔離", async ({ page }) => {
  await setup(page);
  const resumeRegion = page.getByRole("region", { name: "我的履歷", exact: true });
  const jobsRegion = page.getByRole("region", { name: /職缺清單/ });
  await expect(resumeRegion.getByRole("heading", { name: "補充經歷與作品來源" })).toBeVisible();
  await expect(jobsRegion.getByRole("heading", { name: "補充經歷與作品來源" })).toHaveCount(0);
  await expect(jobsRegion.getByRole("link", { name: "查看比對結果", exact: true })).toHaveCount(3);
  await expect(jobsRegion.getByRole("button", { name: /提取|核對|分析|比對/ })).toHaveCount(0);
  await page.getByRole("button", { name: "提取履歷事實", exact: true }).click();
  await page.getByRole("link", { name: "核對履歷事實", exact: true }).click();
  await page.getByRole("button", { name: /^(確認核對內容|確認履歷並比對全部職缺)$/ }).click();
  await page.getByRole("link", { name: "查看全部職缺結果", exact: true }).click();
  await expect(page.getByText("已完成 3／3 份", { exact: true })).toBeVisible();
  await expect(jobsRegion.getByRole("list", { name: "目前履歷的比對摘要" })).toHaveCount(3);
  const completed = await (await page.request.get("/api/workspace")).json();
  expect(completed.analyses.length).toBe(3);
  expect(completed.reviews.filter((r: { confirmed: boolean; documentId: string }) => r.documentId !== completed.documents[0].id).every((r: { confirmed: boolean }) => !r.confirmed)).toBe(true);
  const count = completed.runs.length;
  await page.reload();
  await expect(page.getByText("已完成 3／3 份", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "更新全部職缺比對", exact: true }).click();
  await expect(page.getByRole("button", { name: "取消執行", exact: true })).toBeHidden();
  expect((await (await page.request.get("/api/workspace")).json()).runs.length).toBe(count);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `docs/evidence/browser/batch-home-${width}.png`, fullPage: true });
  }
  await jobsRegion.getByRole("link", { name: "查看比對結果", exact: true }).first().click();
  await expect(page.getByText("職缺條件由 AI 提取，尚未人工核對。", { exact: false })).toBeVisible();
  await expect(page.getByText("逐項判斷已通過引用驗證", { exact: false })).toBeVisible();
  await page.goto("/");
  await page.getByRole("button", { name: "＋ 貼上履歷", exact: true }).click();
  await page.getByLabel("名稱", { exact: true }).fill("第二份合成履歷");
  await page.getByLabel("使用者提供的原文", { exact: true }).fill("使用 React Native 開發 iOS App。");
  await page.getByLabel(/同意保存在本機資料庫/).check();
  await page.getByRole("button", { name: "保存原文", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const other = (await (await page.request.get("/api/workspace")).json()).documents.find((d: { title: string }) => d.title === "第二份合成履歷");
  await page.getByRole("combobox", { name: "比對的履歷", exact: true }).selectOption(other.id);
  await expect(jobsRegion.getByRole("list", { name: "目前履歷的比對摘要" })).toHaveCount(0);
  await expect(page.getByText("已完成 0／3 份", { exact: true })).toBeVisible();
  await expect(jobsRegion.getByRole("link", { name: "查看比對結果", exact: true })).toHaveCount(3);
  expect((await (await page.request.get("/api/workspace")).json()).runs.length).toBe(count);
  expect((await (await page.request.get("/api/usage")).json()).length).toBe(0);
});

test("實際尺寸、無障礙、鍵盤、縮放與減少動畫", async ({ page }) => {
  await setup(page);
  const { job } = await arrangePair(page);
  await page.goto(`/analysis/${job.id}`);
  await page.getByRole("button", { name: "更新全部職缺比對", exact: true }).click();
  await expect(
    page.getByText("逐項判斷已通過引用驗證", { exact: false }),
  ).toBeVisible();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: `docs/evidence/browser/analysis-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    fs.writeFileSync(
      `docs/evidence/browser/axe-${width}.json`,
      JSON.stringify(audit.violations, null, 2),
    );
    expect(audit.violations).toEqual([]);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    document.body.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/evidence/browser/zoom-200.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    document.body.style.zoom = "1";
  });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "跳到主要內容" })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.getByRole("button", { name: "＋ 貼上履歷" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "＋ 貼上履歷" })).toBeFocused();
});
test("空資料、長度、模擬失敗、取消、清除不復活", async ({ page }) => {
  await setup(page);
  await page.getByRole("link", { name: "資料與用量" }).click();
  await page.getByRole("button", { name: "清除全部本機紀錄" }).click();
  await page.getByLabel("輸入「清除」").fill("清除");
  await page.getByRole("button", { name: "確認清除", exact: true }).click();
  await page.getByRole("link", { name: "工作台", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "先放入履歷，或從合成範例開始" }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/evidence/browser/empty.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "＋ 貼上職缺" }).click();
  await expect(page.getByLabel("使用者提供的原文")).toHaveAttribute(
    "maxlength",
    "8000",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "載入合成範例" }).click();
  await expect(
    page.getByRole("heading", { name: "林知遠的合成履歷" }),
  ).toBeVisible();
  await page.route("**/api/runs", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        message: "模擬故障：模型服務暫時失敗（非真實供應商事件）。",
      }),
    });
  });
  await page
    .getByRole("button", { name: "提取履歷事實", exact: true })
    .first()
    .click();
  await expect(page.locator("main [role=alert]")).toContainText("模擬故障");
  await page.screenshot({
    path: "docs/evidence/browser/simulated-error.png",
    fullPage: true,
  });
  await page.unroute("**/api/runs");
  await page.getByRole("button", { name: "收起訊息" }).click();
  await page
    .getByRole("button", { name: "提取履歷事實", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "取消執行", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "取消執行", exact: true }),
  ).toBeHidden();
  await page.screenshot({
    path: "docs/evidence/browser/cancel.png",
    fullPage: true,
  });
});
