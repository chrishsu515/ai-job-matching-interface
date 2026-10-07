import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../src/server/config";
const key = getConfig().key;
let count = 0;
function scan(dir: string) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (/\.(js|map|json|html|md|ts|tsx|vtt)$/.test(entry.name)) {
      count++;
      const contents = fs.readFileSync(file, "utf8");
      if (key && contents.includes(key))
        throw new Error("發現金鑰洩漏，位置：" + file);
    }
  }
}
for (const dir of ["src", "docs", "scripts", "tests", ".next/static"])
  scan(dir);
console.log(`已掃描 ${count} 個原始碼、文件與瀏覽器產物，沒有本機金鑰。`);
