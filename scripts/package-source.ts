import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../src/server/config";
const root = process.cwd();
const target = path.join(root, "exports", "source-" + Date.now());
const key = getConfig().key;
const files: string[] = [];
const ignored = new Set([
  "private",
  "node_modules",
  "data",
  "exports",
  ".next",
  "test-results",
  "playwright-report",
]);
function copy(source: string, destination: string) {
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const name of fs.readdirSync(source)) {
      if (
        ignored.has(name) ||
        (name.startsWith(".env") && name !== ".env.example")
      )
        continue;
      copy(path.join(source, name), path.join(destination, name));
    }
  } else {
    const content = fs.readFileSync(source);
    if (key && content.includes(Buffer.from(key)))
      throw new Error("交付內容發現憑證，封裝已停止。");
    fs.copyFileSync(source, destination);
    files.push(path.relative(target, destination));
  }
}
fs.mkdirSync(target, { recursive: true });
for (const name of [
  "src",
  "scripts",
  "tests",
  "docs",
  "AGENTS.md",
  "README.md",
  "PROJECT_FUNCTIONS_AND_WORKFLOWS.md",
  ".env.example",
  ".gitignore",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next-env.d.ts",
  "next.config.ts",
  "eslint.config.mjs",
  "vitest.config.ts",
  "playwright.config.ts",
])
  copy(path.join(root, name), path.join(target, name));
fs.writeFileSync(
  path.join(root, "exports", "manifest.json"),
  JSON.stringify(
    {
      date: new Date().toISOString(),
      sourceDirectory: target,
      files,
      keyIncluded: false,
      databaseIncluded: false,
    },
    null,
    2,
  ),
);
console.log(`可分享原始碼已準備：${files.length} 個檔案，沒有憑證或資料庫。`);
