import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { parse } from "dotenv";
import { getConfig } from "../src/server/config";
import type { Mode } from "../src/domain/types";

// 每次錄影使用新的合成資料庫，避免清除或操作日常工作區。
export async function recordingEnvironment(mode: Mode) {
  const root = process.cwd();
  const directory = path.join(root, "data", "recordings", `${mode}-${crypto.randomUUID()}`);
  const origin = "http://localhost:3002";
  console.log("正在準備隔離錄影環境。");
  if (mode === "real") {
    const config = getConfig();
    if (config.mode !== "real" || !config.ready) throw new Error("真實錄影需要已設定的真實模型與有效金鑰。");
  }
  try {
    await fetch(origin, { signal: AbortSignal.timeout(1500) });
    throw new Error("錄影專用連接埠已被占用。");
  } catch (error) {
    if (error instanceof Error && error.message.includes("占用")) throw error;
  }
  fs.mkdirSync(directory, { recursive: true });
  console.log("正在複製錄影用程式與空白資料環境。");
  const copy = (source: string, target: string) => {
    if (fs.statSync(source).isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      for (const name of fs.readdirSync(source)) copy(path.join(source, name), path.join(target, name));
    } else fs.copyFileSync(source, target);
  };
  for (const name of ["src", "tsconfig.json", "next-env.d.ts", "next.config.ts", "package.json"]) {
    copy(path.join(root, name), path.join(directory, name));
  }
  fs.symlinkSync(path.join(root, "node_modules"), path.join(directory, "node_modules"), "junction");
  const template = parse(fs.readFileSync(path.join(root, ".env.example")));
  const source = mode === "real" ? parse(fs.readFileSync(path.join(root, ".env"))) : template;
  const fields = Object.fromEntries(Object.keys(template).map((name) => [name, source[name] ?? template[name]]));
  Object.assign(fields, { APP_MODE: mode, MODEL_API_KEY: mode === "real" ? source.MODEL_API_KEY : "", DATA_DIR: "database", APP_ORIGIN: origin });
  const envPath = path.join(directory, ".env");
  fs.writeFileSync(envPath, Object.entries(fields).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join("\n"));
  const server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3002"], {
    cwd: directory, stdio: "ignore", windowsHide: true, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  console.log("正在啟動隔離錄影服務。");
  let closed = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    if (server.pid && server.exitCode === null) {
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else server.kill("SIGTERM");
    }
    if (fs.existsSync(envPath)) fs.unlinkSync(envPath);
  };
  process.once("exit", stop);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { stop(); process.exit(1); });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 180; attempt++) {
      if (server.exitCode !== null) throw new Error("隔離錄影服務啟動失敗。");
      try {
        if ((await fetch(`${origin}/api/settings`, { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error("隔離錄影服務啟動逾時。");
    // 錄影前完成頁面編譯，影片保留真實模型等待而不混入開發編譯。
    for (const route of ["/", "/settings", "/review/warmup", "/analysis/warmup", "/rewrite/warmup"]) {
      await fetch(origin + route, { signal: AbortSignal.timeout(60000) });
    }
    return { origin, stop };
  } catch (error) { stop(); throw error; }
}
