import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as config from "../src/server/config";
import { closeDatabases, list } from "../src/server/db";
import { callModel } from "../src/server/model/provider";
import { parseSchema } from "../src/domain/schemas";
import { limits } from "../src/server/model/prompts";
import type { Usage } from "../src/domain/types";
let dir: string;
beforeEach(() => {
  (
    globalThis as typeof globalThis & { modelCallTimes?: number[] }
  ).modelCallTimes = [];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "provider-test-"));
  vi.spyOn(config, "getConfig").mockReturnValue({
    ...config.getConfig(),
    mode: "real",
    key: "test-only",
    ready: true,
    dataDir: dir,
  });
});
it("結構驗證耗時實測記錄，未量測欄位不偽造", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(
        () =>
          new Response(
            'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"text":"{\\"items\\":[],\\"warnings\\":[],\\"conflicts\\":[]}"}]}],"usage":{"cost_in_usd_ticks":1000,"input_tokens":10,"output_tokens":5}}}\n\n',
          ),
      ),
  );
  await callModel("parse_job", {}, parseSchema, "timing");
  expect(list<Usage>("usage")[0].validationMs).toBeGreaterThanOrEqual(0);
});
afterEach(() => {
  closeDatabases();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});
it("憑證失敗與參數拒絕不自動重送，費用未知", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("{}", { status: 401 }))
    .mockResolvedValueOnce(new Response("{}", { status: 400 }));
  vi.stubGlobal("fetch", fetch);
  await expect(
    callModel("parse_job", {}, parseSchema, "auth"),
  ).rejects.toMatchObject({ code: "PROVIDER_AUTH", retryable: false });
  await expect(
    callModel("parse_job", {}, parseSchema, "params"),
  ).rejects.toMatchObject({ code: "PROVIDER_REQUEST", retryable: false });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(list<Usage>("usage").every((u) => u.billedTicks === null)).toBe(true);
});
it("截斷已計費保存費用，連線中斷不重送", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          'data: {"type":"response.incomplete","response":{"usage":{"cost_in_usd_ticks":1234,"input_tokens":10,"output_tokens":2}}}\n\n',
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          'data: {"type":"response.output_text.delta","delta":"{"}\n\n',
        ),
      ),
  );
  await expect(
    callModel("parse_job", {}, parseSchema, "truncated"),
  ).rejects.toMatchObject({ code: "OUTPUT_TRUNCATED", retryable: false });
  expect(list<Usage>("usage")[0].billedTicks).toBe("1234");
  await expect(
    callModel("parse_job", {}, parseSchema, "disconnect"),
  ).rejects.toMatchObject({ code: "STREAM_INTERRUPTED", retryable: false });
});
it("長度在上游請求前阻擋", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    callModel("parse_job", { text: "中".repeat(36000) }, parseSchema, "long"),
  ).rejects.toMatchObject({ code: "INPUT_TOO_LONG" });
  expect(fetch).not.toHaveBeenCalled();
});
it("模型拒絕內容不重送，仍保存已知費用", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          'data: {"type":"response.refusal.delta","delta":"拒絕"}\n\ndata: {"type":"response.completed","response":{"usage":{"cost_in_usd_ticks":4321,"input_tokens":10,"output_tokens":2}}}\n\n',
        ),
      ),
  );
  await expect(
    callModel("parse_job", {}, parseSchema, "refused"),
  ).rejects.toMatchObject({ code: "PROVIDER_REFUSAL", retryable: false });
  expect(list<Usage>("usage")[0].billedTicks).toBe("4321");
});
it("逾時不重送", async () => {
  const previous = limits.parse_job.timeout;
  limits.parse_job.timeout = 20;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new Error("模擬逾時")),
          );
        }),
    ),
  );
  try {
    await expect(
      callModel("parse_job", {}, parseSchema, "timeout"),
    ).rejects.toMatchObject({ code: "TIMEOUT", retryable: false });
  } finally {
    limits.parse_job.timeout = previous;
  }
});
