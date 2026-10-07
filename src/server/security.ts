import crypto from "node:crypto";
import { cookies } from "next/headers";
import { AppError, requireCondition } from "@/domain/errors";

const root = globalThis as typeof globalThis & { jobSessionSecret?: string };
const secret = (root.jobSessionSecret ||= crypto
  .randomBytes(32)
  .toString("hex"));
const sign = (nonce: string) =>
  crypto.createHmac("sha256", secret).update(nonce).digest("hex");
export async function secureRequest(request: Request, bootstrap = false) {
  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  requireCondition(
    /^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host),
    "LOCAL_ONLY",
    "本服務只允許本機回環位址。",
    403,
  );
  const origin = request.headers.get("origin");
  requireCondition(
    !origin || origin === `http://${host}`,
    "ORIGIN_DENIED",
    "拒絕跨來源請求。",
    403,
  );
  const jar = await cookies();
  const token = jar.get("job_session")?.value || "";
  const [nonce, signature] = token.split(".");
  const valid =
    nonce &&
    signature &&
    /^[a-f0-9]{64}$/.test(signature) &&
    crypto.timingSafeEqual(Buffer.from(sign(nonce)), Buffer.from(signature));
  if (!valid && bootstrap && request.method === "GET") {
    const nextNonce = crypto.randomBytes(24).toString("hex");
    jar.set("job_session", nextNonce + "." + sign(nextNonce), {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
    });
    return;
  }
  if (!valid)
    throw new AppError(
      "SESSION_REQUIRED",
      "本機工作階段已失效，請重新整理工作台。",
      403,
    );
  if (!["GET", "HEAD"].includes(request.method))
    requireCondition(
      !!origin &&
        request.headers.get("content-type")?.includes("application/json"),
      "WRITE_DENIED",
      "寫入請求需要同源工作階段及資料格式。",
      403,
    );
}
