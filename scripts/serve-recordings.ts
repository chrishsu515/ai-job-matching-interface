import http from "node:http";
import fs from "node:fs";
import path from "node:path";

// 只提供可分享的合成錄影，不開放任意本機路徑或工作區設定。
const root = path.join(process.cwd(), "docs", "evidence");
const files = new Map([
  ["/", "video-showcase.html"],
  ["/demo-fixture.webm", "video-demo/demo-fixture.webm"],
  ["/demo-fixture.vtt", "video-demo/demo-fixture.vtt"],
  ["/batch-live-flow.webm", "video-live/batch-live-flow.webm"],
  ["/batch-live-flow.vtt", "video-live/batch-live-flow.vtt"],
  ["/fixture-poster.png", "video-demo/all-jobs-complete.png"],
  ["/real-poster.png", "video-live/all-jobs-complete.png"],
  ["/fixture-metadata.json", "video-demo/metadata.json"],
  ["/real-metadata.json", "video-live/metadata.json"],
]);
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".webm": "video/webm", ".vtt": "text/vtt; charset=utf-8", ".png": "image/png", ".json": "application/json; charset=utf-8" };
const server = http.createServer((request, response) => {
  const relative = files.get(new URL(request.url || "/", "http://localhost").pathname);
  if (!relative || !["GET", "HEAD"].includes(request.method || "")) { response.writeHead(404).end("找不到影片資源。"); return; }
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) { response.writeHead(404).end("影片尚未完成。"); return; }
  const size = fs.statSync(file).size;
  response.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  const range = request.headers.range;
  let start = 0, end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) { response.writeHead(416, { "Content-Range": `bytes */${size}` }).end(); return; }
    start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start < 0 || start >= size || end < start) { response.writeHead(416, { "Content-Range": `bytes */${size}` }).end(); return; }
    response.statusCode = 206;
    response.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  response.setHeader("Content-Length", end - start + 1);
  if (request.method === "HEAD") { response.end(); return; }
  fs.createReadStream(file, { start, end }).on("error", () => response.destroy()).pipe(response);
});
server.on("error", () => { console.error("影片服務無法啟動，請確認連接埠 3003 未被占用。"); process.exitCode = 1; });
server.listen(3003, "127.0.0.1", () => console.log("本機影片預覽：http://localhost:3003，播放器至少占畫面一半。"));
