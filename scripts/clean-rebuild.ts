import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
const root = process.cwd();
const dir = path.join(root, "data", "clean-room-" + Date.now());
fs.mkdirSync(dir, { recursive: true });
function copy(source: string, target: string) {
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(source))
      copy(path.join(source, name), path.join(target, name));
  } else fs.copyFileSync(source, target);
}
for (const name of [
  "src",
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "tsconfig.json",
  "next-env.d.ts",
  ".env.example",
  "README.md",
])
  copy(path.join(root, name), path.join(dir, name));
fs.writeFileSync(
  path.join(dir, ".env"),
  fs
    .readFileSync(".env.example", "utf8")
    .replace("http://localhost:3000", "http://localhost:3002"),
);
const steps: { step: string; output: string }[] = [];
function npm(command: string) {
  const output = execFileSync(
    process.env.ComSpec || "cmd.exe",
    ["/d", "/s", "/c", "npm " + command],
    {
      cwd: dir,
      encoding: "utf8",
      timeout: 180000,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    },
  );
  steps.push({ step: command, output });
  console.log("乾淨目錄已完成：" + command);
}
function start() {
  return spawn(
    process.execPath,
    [
      path.join(dir, "node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3002",
    ],
    { cwd: dir, stdio: "pipe" },
  );
}
async function ready() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch("http://localhost:3002")).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("正式服務沒有啟動。");
}
npm("ci --no-audit --no-fund");
npm("run build");
let server = start();
await ready();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
try {
  await page.goto("http://localhost:3002");
  await page.getByRole("button", { name: "＋ 貼上履歷" }).click();
  await page.getByLabel("名稱", { exact: true }).fill("乾淨目錄保存驗收");
  await page
    .getByLabel("使用者提供的原文")
    .fill("這是本機資料讀寫驗收合成文字。");
  await page.getByLabel(/同意保存在本機資料庫/).check();
  await page.getByRole("button", { name: "保存原文" }).click();
  await page
    .getByRole("heading", { name: "乾淨目錄保存驗收", exact: true })
    .waitFor();
  await new Promise<void>((resolve) => {
    server.once("exit", () => resolve());
    server.kill();
  });
  server = start();
  await ready();
  await page.reload();
  await page
    .getByRole("heading", { name: "乾淨目錄保存驗收", exact: true })
    .waitFor();
  await page.screenshot({
    path: path.join(root, "docs/evidence/clean-restart.png"),
    fullPage: true,
  });
  fs.writeFileSync(
    path.join(root, "docs/evidence/clean-rebuild.json"),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        cleanDirectory: dir,
        steps,
        savedViaBrowser: true,
        persistedAfterRestart: true,
        mode: "fixture",
        keyCopied: false,
      },
      null,
      2,
    ),
  );
  console.log("乾淨目錄正式建置、畫面保存及重新啟動資料保留通過。");
} finally {
  server.kill();
  await browser.close();
}
