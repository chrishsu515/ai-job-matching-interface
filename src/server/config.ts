import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parse } from "dotenv";
import type { Mode, SettingsSummary } from "@/domain/types";
import { AppError } from "@/domain/errors";

export type Config = ReturnType<typeof getConfig>;
export function getConfig() {
  // 只讀根目錄設定檔，不接受瀏覽器參數或其他環境檔覆寫模型設定。
  const file = path.join(process.cwd(), ".env");
  const env = fs.existsSync(file) ? parse(fs.readFileSync(file)) : {};
  const mode: Mode = env.APP_MODE === "real" ? "real" : "fixture";
  const key = (env.MODEL_API_KEY || "").trim();
  const provider = env.MODEL_PROVIDER || "xai";
  const baseUrl = env.MODEL_BASE_URL || "https://api.x.ai/v1";
  const model = env.MODEL_NAME || "grok-4.3";
  const protocol = env.MODEL_PROTOCOL || "responses";
  // Grok Build 已實測拒絕推理參數；保留模型原生推理並記錄用量。
  const reasoning =
    model === "grok-build-0.1" ? "" : (env.MODEL_REASONING ?? "none");
  const number = (name: string, fallback: number) => {
    const n = Number(env[name] ?? fallback);
    if (!Number.isFinite(n) || n < 0)
      throw new AppError("CONFIG_INVALID", "設定檔的數值不合法。", 409);
    return n;
  };
  const prices = {
    input: number("MODEL_INPUT_PRICE", 1.25),
    cached: number("MODEL_CACHED_PRICE", 0.2),
    output: number("MODEL_OUTPUT_PRICE", 2.5),
  };
  // 本機資料在執行時讀取，不打包進伺服器產物。
  const dataDir = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    env.DATA_DIR || "data",
  );
  const origin = env.APP_ORIGIN || "http://localhost:3000";
  const fingerprint = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        mode,
        provider,
        baseUrl,
        model,
        protocol,
        reasoning,
        prices,
        keyHash: crypto.createHash("sha256").update(key).digest("hex"),
      }),
    )
    .digest("hex")
    .slice(0, 16);
  let reason: string | null = null;
  if (env.APP_MODE && !["fixture", "real"].includes(env.APP_MODE))
    reason =
      "APP_MODE（執行模式）只能為 fixture（固定範例）或 real（真實模型）。";
  if (
    mode === "real" &&
    (!key || !/^[\x21-\x7e]+$/.test(key) || /自行|replace|your.key/i.test(key))
  )
    reason = "請在 .env 設定有效的模型金鑰，再重新啟動。";
  if (
    provider !== "xai" ||
    protocol !== "responses" ||
    baseUrl !== "https://api.x.ai/v1"
  )
    reason = "第一版只支援 xAI 全球 Responses 端點；請檢查設定檔。";
  const summary: SettingsSummary = {
    mode,
    provider,
    model,
    ready: !reason,
    reason,
    dataDir,
    origin,
    fingerprint,
    prices,
  };
  return {
    ...summary,
    key,
    baseUrl,
    protocol,
    reasoning,
    retries: Math.min(1, number("MODEL_RETRIES", 1)),
    callsPerMinute: Math.max(
      1,
      Math.min(6, number("MODEL_CALLS_PER_MINUTE", 6)),
    ),
  };
}
export function getSettings(): SettingsSummary {
  const {
    mode,
    provider,
    model,
    ready,
    reason,
    dataDir,
    origin,
    fingerprint,
    prices,
  } = getConfig();
  return {
    mode,
    provider,
    model,
    ready,
    reason,
    dataDir,
    origin,
    fingerprint,
    prices,
  };
}
