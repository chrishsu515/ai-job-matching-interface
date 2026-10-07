import { NextResponse } from "next/server";
import { z } from "zod";
import type { Document, Review, Run } from "@/domain/types";
import { runInputSchema } from "@/domain/schemas";
import { publicError, requireCondition } from "@/domain/errors";
import { secureRequest } from "@/server/security";
import {
  createDocument,
  documentWithVersion,
  operation,
  usageList,
  workspace,
} from "@/server/repository";
import { getSettings } from "@/server/config";
import { clearData, get, put } from "@/server/db";
import {
  abortAllRuns,
  cancelRun,
  createRun,
  executeRun,
  reconcileRuns,
  isExecuting,
} from "@/server/runs";
import { previewInput } from "@/server/model/tasks";
import {
  decideRewrite,
  createManualReview,
  deleteDocument,
  restoreRevision,
  updateReview,
} from "@/server/services";
import { demoJobs, demoResume } from "@/domain/demo";
import { abortAllBatches, cancelBatch, createBatch, executeBatch, reconcileBatches } from "@/server/batches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
async function handler(request: Request, context: Context) {
  try {
    const paths = (await context.params).path;
    const [resource, identifier, action] = paths;
    await secureRequest(
      request,
      resource === "workspace" || resource === "settings",
    );
    reconcileRuns();
    reconcileBatches();
    const method = request.method;
    const key = request.headers.get("idempotency-key") || "";
    let body: {
      document?: unknown;
      revision?: number;
      favorite?: boolean;
      versionId?: string;
      currentRevisionId?: string;
      confirm?: string;
      all?: boolean;
    } = {};
    if (!["GET", "HEAD"].includes(method)) {
      const text = await request.text();
      requireCondition(
        Buffer.byteLength(text, "utf8") <= 256 * 1024,
        "INPUT_TOO_LONG",
        "請求超過輸入上限。",
        413,
      );
      try {
        body = JSON.parse(text);
      } catch {
        return NextResponse.json(
          { code: "INPUT_INVALID", message: "請求格式不正確。" },
          { status: 400 },
        );
      }
      requireCondition(
        body && typeof body === "object" && !Array.isArray(body),
        "INPUT_INVALID",
        "請求必須是結構資料。",
        422,
      );
    }
    const json = (value: unknown) =>
      NextResponse.json(value, { headers: { "Cache-Control": "no-store" } });
    if (resource === "workspace" && method === "GET") return json(workspace());
    if (resource === "settings" && method === "GET") return json(getSettings());
    if (resource === "usage" && method === "GET") return json(usageList());
    if (resource === "batches" && method === "POST") {
      if (action === "cancel") return json(cancelBatch(identifier));
      const input = z.object({ resumeId: z.string().min(1) }).strict().parse(body);
      const batch = createBatch(input.resumeId, key);
      // 本機常駐 Node.js 服務持續執行；重新整理只查狀態，不重新啟動模型。
      if (batch.status === "running") void executeBatch(batch);
      return json(batch);
    }
    if (resource === "seed" && method === "POST") {
      return json(
        operation(key, { seed: true }, () => {
          createDocument({
            kind: "resume",
            title: "林知遠的合成履歷",
            text: demoResume,
            consent: true,
          });
          for (const job of demoJobs)
            createDocument({ kind: "job", ...job, consent: true });
          return { ok: true };
        }),
      );
    }
    if (resource === "documents" && method === "POST")
      return json(operation(key, body, () => createDocument(body)));
    if (resource === "documents" && method === "GET")
      return json(
        identifier ? documentWithVersion(identifier) : workspace().documents,
      );
    if (resource === "documents" && method === "PUT")
      return json(createDocument(body.document, identifier, body.revision));
    if (resource === "documents" && method === "DELETE") {
      abortAllBatches();
      abortAllRuns();
      deleteDocument(identifier);
      return json({ ok: true });
    }
    if (resource === "jobs" && method === "GET")
      return json(workspace().documents.filter((d) => d.kind === "job"));
    if (resource === "jobs" && method === "PATCH") {
      const job = get<Document>("documents", identifier);
      requireCondition(
        job && job.kind === "job",
        "NOT_FOUND",
        "找不到職缺。",
        404,
      );
      requireCondition(
        job.revision === body.revision && typeof body.favorite === "boolean",
        "VERSION_CONFLICT",
        "職缺已變更，請重新整理。",
        409,
      );
      return json(
        put("documents", {
          ...job,
          favorite: body.favorite,
          revision: job.revision + 1,
        }),
      );
    }
    if (resource === "reviews" && method === "PUT")
      return json(updateReview(identifier, body));
    if (resource === "reviews" && method === "POST") {
      const value = z
        .object({ documentId: z.string().min(1) })
        .strict()
        .parse(body);
      return json(
        operation(key, value, () => createManualReview(value.documentId)),
      );
    }
    if (resource === "reviews" && method === "GET") {
      const review = get<Review>("reviews", identifier);
      requireCondition(review, "NOT_FOUND", "找不到核對紀錄。", 404);
      return json(review);
    }
    if (resource === "preview" && method === "POST")
      return json(previewInput(runInputSchema.parse(body)));
    if (resource === "runs" && method === "GET") {
      const run = get<Run>("runs", identifier);
      requireCondition(run, "NOT_FOUND", "找不到執行紀錄。", 404);
      return json(run);
    }
    if (resource === "runs" && action === "cancel" && method === "POST")
      return json(cancelRun(identifier));
    if (resource === "runs" && method === "POST") {
      const run = createRun(runInputSchema.parse(body), key);
      if (run.status === "failed" || run.status === "cancelled")
        return json(run);
      if (isExecuting(run.id))
        return json({ ...get<Run>("runs", run.id), reused: true });
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let closed = false;
          const notify = (value: unknown) => {
            if (!closed)
              try {
                controller.enqueue(
                  encoder.encode("data: " + JSON.stringify(value) + "\n\n"),
                );
              } catch {
                closed = true;
              }
          };
          const heartbeat = setInterval(() => {
            if (!closed)
              try {
                controller.enqueue(encoder.encode(": 等待處理\n\n"));
              } catch {
                closed = true;
              }
          }, 10000);
          try {
            await executeRun(run, notify, request.signal);
          } catch (error) {
            notify({ type: "error", ...publicError(error) });
          } finally {
            clearInterval(heartbeat);
            if (!closed) {
              closed = true;
              controller.close();
            }
          }
        },
        cancel() {
          if (get<Run>("runs", run.id)) cancelRun(run.id);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
        },
      });
    }
    if (
      resource === "rewrites" &&
      method === "POST" &&
      (action === "accept" || action === "reject")
    )
      return json(decideRewrite(identifier, action, body.versionId || "", key));
    if (
      resource === "resume-revisions" &&
      action === "restore" &&
      method === "POST"
    )
      return json(
        restoreRevision(identifier, body.currentRevisionId || "", key),
      );
    if (resource === "local-data" && method === "DELETE") {
      requireCondition(
        body.confirm === "清除",
        "CONFIRM_REQUIRED",
        "請輸入清除確認文字。",
      );
      abortAllRuns();
      abortAllBatches();
      clearData(body.all === true);
      return json({ ok: true });
    }
    return NextResponse.json(
      { code: "NOT_FOUND", message: "找不到此操作入口。" },
      { status: 404 },
    );
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json(
        {
          code: "INPUT_INVALID",
          message: "輸入資料不符合規格，請檢查欄位與長度。",
        },
        { status: 422 },
      );
    const detail = publicError(error);
    return NextResponse.json(
      { code: detail.code, message: detail.message },
      { status: detail.status },
    );
  }
}
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
