import { z } from "zod";
import type { Task, Usage } from "@/domain/types";
import { AppError, requireCondition } from "@/domain/errors";
import { sseFrames } from "@/domain/sse";
import { getConfig, type Config } from "../config";
import { generation, put } from "../db";
import { id, now } from "../repository";
import { fixtureResult } from "./fixture";
import { limits, PROMPT_VERSION, prompts } from "./prompts";
import { reserveCall } from "./limiter";

export type ProviderOptions = {
  config?: Config;
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
  attempt?: number;
};
export function estimatedCost(
  input: number | null,
  cached: number | null,
  output: number | null,
  prices: Config["prices"],
) {
  if (input === null || output === null) return null;
  return (
    ((input - Math.min(input, cached || 0)) * prices.input +
      Math.min(input, cached || 0) * prices.cached +
      output * prices.output) /
    1e6
  );
}
export async function callModel<T>(
  task: Task,
  payload: unknown,
  schema: z.ZodType<T>,
  runId: string,
  options: ProviderOptions = {},
): Promise<T> {
  const config = options.config || getConfig();
  requireCondition(
    config.ready,
    "CONFIG_REQUIRED",
    config.reason || "模型設定不完整。",
    409,
  );
  const schemaJson = z.toJSONSchema(schema);
  const repair =
    (options.attempt || 1) > 1
      ? "上一次格式或引用未通過。重新核對每個來源識別碼及精確引句，完整覆蓋要求，不要猜測位置或補造事實。"
      : "";
  const input = [
    { role: "system", content: prompts[task] + repair },
    { role: "user", content: JSON.stringify(payload) },
  ];
  const body: Record<string, unknown> = {
    model: config.model,
    input,
    stream: true,
    store: false,
    max_output_tokens: limits[task].output,
    text: {
      format: {
        type: "json_schema",
        name: task,
        schema: schemaJson,
        strict: true,
      },
    },
  };
  if (config.reasoning) body.reasoning = { effort: config.reasoning };
  requireCondition(
    Buffer.byteLength(JSON.stringify(body), "utf8") <= limits[task].bytes,
    "INPUT_TOO_LONG",
    "完整模型輸入超過上限，請縮短原文或條件。",
    413,
  );
  if (config.mode === "fixture") {
    options.onProgress?.("正在讀取固定範例（沒有呼叫模型）");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 200);
      options.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new AppError("CANCELLED", "已取消。", 409));
        },
        { once: true },
      );
      if (options.signal?.aborted) {
        clearTimeout(timer);
        reject(new AppError("CANCELLED", "已取消。", 409));
      }
    });
    return schema.parse(fixtureResult(task, payload));
  }
  const started = performance.now();
  reserveCall(config.callsPerMinute);
  const dataGeneration = generation();
  const usage: Usage = {
    id: id(),
    runId,
    task,
    mode: "real",
    model: config.model,
    returnedModel: null,
    providerId: null,
    promptVersion: PROMPT_VERSION,
    configFingerprint: config.fingerprint,
    attempt: options.attempt || 1,
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    reasoningTokens: null,
    billedTicks: null,
    estimatedUsd: null,
    durationMs: 0,
    firstContentMs: null,
    result: "failed",
    prices: config.prices,
    createdAt: now(),
  };
  const persist = () => {
    if (generation() === dataGeneration) put("usage", usage);
  };
  persist();
  const signal = AbortSignal.any([
    options.signal || new AbortController().signal,
    AbortSignal.timeout(limits[task].timeout),
  ]);
  let output = "";
  let terminal = false;
  let refused = false;
  let receivedContent = false;
  let validationStarted: number | null = null;
  try {
    options.onProgress?.("模型正在生成");
    const response = await fetch(config.baseUrl + "/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + config.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new AppError(
          "PROVIDER_AUTH",
          "模型金鑰或權限不正確，請修改設定檔。",
          502,
        );
      if (response.status === 429)
        throw new AppError(
          "PROVIDER_RATE_LIMIT",
          "模型服務限制流量，請稍後再試。",
          503,
          true,
        );
      if (response.status === 400 || response.status === 422)
        throw new AppError(
          "PROVIDER_REQUEST",
          "模型服務拒絕請求參數，請核對模型能力、結構規格及設定。",
          502,
          false,
        );
      throw new AppError(
        "PROVIDER_ERROR",
        "模型服務暫時無法處理，結果未套用。",
        502,
        response.status >= 500,
      );
    }
    requireCondition(
      response.body,
      "PROVIDER_EMPTY",
      "模型沒有回傳內容。",
      502,
    );
    for await (const data of sseFrames(response.body)) {
      const event = JSON.parse(data);
      if (
        event.type === "response.refusal.delta" ||
        event.type === "response.refusal.done"
      )
        refused = true;
      if (event.type === "response.output_text.delta") {
        if (usage.firstContentMs === null)
          usage.firstContentMs = Math.round(performance.now() - started);
        receivedContent = true;
        output += event.delta || "";
        requireCondition(
          output.length <= 128 * 1024,
          "OUTPUT_TOO_LONG",
          "模型輸出超過安全上限。",
          502,
        );
      }
      if (
        event.type === "response.completed" ||
        event.type === "response.incomplete"
      ) {
        const result = event.response;
        const u = result.usage || {};
        usage.inputTokens =
          typeof u.input_tokens === "number" ? u.input_tokens : null;
        usage.outputTokens =
          typeof u.output_tokens === "number" ? u.output_tokens : null;
        usage.cachedTokens = u.input_tokens_details?.cached_tokens ?? null;
        usage.reasoningTokens =
          u.output_tokens_details?.reasoning_tokens ?? null;
        usage.billedTicks =
          u.cost_in_usd_ticks != null ? String(u.cost_in_usd_ticks) : null;
        usage.returnedModel = result.model || null;
        usage.providerId = result.id || null;
        usage.estimatedUsd = estimatedCost(
          usage.inputTokens,
          usage.cachedTokens,
          usage.outputTokens,
          config.prices,
        );
        usage.result = "invalid";
        persist();
        refused ||= !!result.output?.some(
          (item: { content?: { type: string }[] }) =>
            item.content?.some((content) => content.type === "refusal"),
        );
        requireCondition(
          !refused,
          "PROVIDER_REFUSAL",
          "模型拒絕這次分析；內容未採用，請檢查資料範圍。",
          502,
        );
        requireCondition(
          event.type === "response.completed",
          "OUTPUT_TRUNCATED",
          "模型輸出截斷，請縮小分析範圍。",
          502,
        );
        if (!output)
          output =
            result.output
              ?.filter((item: { type: string }) => item.type === "message")
              .flatMap(
                (item: { content: { text?: string }[] }) => item.content || [],
              )
              .map((item: { text?: string }) => item.text || "")
              .join("") || "";
        terminal = true;
      }
      if (event.type === "response.failed" || event.type === "error")
        throw new AppError(
          "PROVIDER_ERROR",
          "模型串流失敗，未交付完整結果。",
          502,
        );
    }
    requireCondition(
      terminal,
      "STREAM_INTERRUPTED",
      "模型連線中斷，請查原執行；未自動重新付費。",
      502,
    );
    let parsed: unknown;
    options.onProgress?.("正在驗證輸出結構");
    validationStarted = performance.now();
    try {
      parsed = JSON.parse(output);
    } catch {
      throw new AppError(
        "OUTPUT_FORMAT",
        "模型格式不正確，結果未採用。",
        422,
        true,
      );
    }
    const validated = schema.safeParse(parsed);
    if (!validated.success)
      throw new AppError(
        "OUTPUT_SCHEMA",
        "模型回應不符合資料規格，結果未採用。",
        422,
        true,
      );
    usage.result = "completed";
    return validated.data;
  } catch (error) {
    if (error instanceof AppError)
      usage.validationError = { code: error.code, message: error.message };
    if (options.signal?.aborted) {
      usage.result = "cancelled";
      throw new AppError(
        "CANCELLED",
        "已取消模型執行，已發生費用可能仍需支付。",
        409,
      );
    }
    if (signal.aborted)
      throw new AppError("TIMEOUT", "模型處理逾時，未自動重新付費。", 504);
    if (error instanceof AppError) {
      if (receivedContent && error.status >= 500) error.retryable = false;
      throw error;
    }
    if (error instanceof SyntaxError)
      throw new AppError("OUTPUT_FORMAT", "模型串流格式不正確。", 422, false);
    throw new AppError(
      "NETWORK",
      "模型連線失敗，處理狀態不明；未自動重新付費。",
      502,
    );
  } finally {
    usage.validationMs =
      validationStarted === null
        ? null
        : Math.round((performance.now() - validationStarted) * 1000) / 1000;
    usage.durationMs = Math.round(performance.now() - started);
    persist();
  }
}
