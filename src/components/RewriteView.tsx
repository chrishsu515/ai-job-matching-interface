"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useApp, request } from "./AppContext";
import { Dialog, Empty, References } from "./primitives";
import s from "./workbench.module.css";
export function RewriteView({ id }: { id: string }) {
  const { data, run, mutate, busy, message, selectedResumeId, selectResume } = useApp();
  const params = useSearchParams();
  const [resumeId, setResumeId] = useState(params.get("resume") || "");
  const [segmentId, setSegmentId] = useState("");
  const [preview, setPreview] = useState<unknown>(null);
  if (!data) return null;
  const job = data.documents.find((d) => d.id === id);
  const resumes = data.documents.filter((d) => d.kind === "resume");
  const selected = resumeId || selectedResumeId;
  const resume = data.documents.find((d) => d.id === selected);
  const version = data.versions.find((v) => v.id === resume?.versionId);
  if (!job || !resume || !version)
    return (
      <Empty title="請先建立履歷與職缺">
        <Link href="/">返回工作台</Link>
      </Empty>
    );
  const selectedSegment =
    segmentId ||
    version.segments.find((s) => !s.excluded && s.text.startsWith("-"))?.id ||
    "";
  const reviewsReady = [id, selected].every(
    (docId) =>
      data.reviews
        .filter(
          (r) =>
            r.documentId === docId &&
            r.versionId ===
              data.documents.find((d) => d.id === docId)?.versionId &&
            r.mode === data.settings.mode,
        )
        .at(-1)?.confirmed,
  );
  const rewrites = data.rewrites
    .filter(
      (r) =>
        r.jobId === id &&
        r.resumeId === selected &&
        r.mode === data.settings.mode,
    )
    .slice()
    .reverse();
  const revisions = data.revisions.filter(
    (r) => r.documentId === selected && r.sourceVersionId === version.id,
  );
  const current = revisions.at(-1);
  const input = {
    task: "rewrite" as const,
    resumeId: selected,
    jobId: id,
    segmentId: selectedSegment,
  };
  return (
    <>
      <Link href={`/analysis/${id}`}>← 條件分析</Link>
      <div className={s.pageHeading}>
        <div>
          <p className={s.eyebrow}>04 改寫與人工決定</p>
          <h1>讓原有事實更清楚</h1>
          <p>目標職缺：{job.title}。職缺只能指引重點，不能變成履歷事實。</p>
        </div>
      </div>
      <div className={s.panel}>
        <div className={s.formColumns}>
          <label>
            履歷
            <select
              value={selected}
              onChange={(e) => {
                setResumeId(e.target.value);
                selectResume(e.target.value);
                setSegmentId("");
              }}
            >
              {resumes.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            選擇原始段落（最多 1,500 字元）
            <select
              value={selectedSegment}
              onChange={(e) => setSegmentId(e.target.value)}
            >
              {version.segments
                .filter((s) => !s.excluded && s.text.length <= 1500)
                .map((s) => (
                  <option value={s.id} key={s.id}>
                    第 {s.line} 行：{s.text}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <p className={s.sourceText}>
          {version.segments.find((s) => s.id === selectedSegment)?.text}
        </p>
        <div className={s.actions}>
          <button
            className={s.primary}
            disabled={!reviewsReady || busy || !selectedSegment}
            onClick={() => void run(input)}
          >
            產生改寫建議
          </button>
          <button
            disabled={!reviewsReady || busy}
            onClick={() =>
              void request("preview", "POST", input)
                .then(setPreview)
                .catch(() => {})
            }
          >
            預覽傳送範圍
          </button>
        </div>
        {!reviewsReady && (
          <p className={s.warning}>
            請先核對並確認履歷與職缺。
            <Link href={`/review/${selected}`}>核對履歷</Link> ·{" "}
            <Link href={`/review/${id}`}>核對職缺</Link>
          </p>
        )}
      </div>
      {rewrites.length ? (
        rewrites.map((r) => (
          <article key={r.id} className={s.panel}>
            <div className={s.row}>
              <h2>
                {r.status === "accepted"
                  ? "已接受的改寫"
                  : r.status === "rejected"
                    ? "已拒絕的提案"
                    : "待決定的建議"}
              </h2>
              <span
                className={`${s.badge} ${r.safe ? s.supported : s.blocked}`}
              >
                {r.safe ? "事實檢查通過，仍需人工核對" : "事實檢查未通過"}
              </span>
            </div>
            <p className={s.muted}>
              {r.mode === "real" ? "真實模型提案" : "固定範例提案"} ·{" "}
              {new Date(r.createdAt).toLocaleString("zh-TW")}
            </p>
            <div className={s.diff}>
              <section>
                <h3>修改前 · 使用者原文</h3>
                <p>{r.before}</p>
              </section>
              <section>
                <h3>修改後 · 模型建議</h3>
                <p>{r.after}</p>
              </section>
            </div>
            <p>
              <strong>修改理由：</strong>
              {r.reason}
            </p>
            <details open={!r.safe}>
              <summary>逐項主張與依據（{r.claims.length} 項）</summary>
              {r.claims.map((c, i) => (
                <div className={s.claim} key={i}>
                  <p>{c.text}</p>
                  <References refs={c.refs} />
                </div>
              ))}
            </details>
            {r.issues.length > 0 && (
              <div className={s.error}>
                <strong>接受已阻擋</strong>
                {r.issues.map((issue, i) => (
                  <p key={i}>{issue}</p>
                ))}
                <p>
                  保留原文、補充可核對事實，或手動重新生成。系統不會自動填入成果。
                </p>
              </div>
            )}
            {r.status === "proposed" && (
              <div className={s.actions}>
                <button
                  className={s.primary}
                  disabled={!r.safe || busy || r.versionId !== version.id}
                  onClick={async () => {
                    try {
                      await mutate(`rewrites/${r.id}/accept`, "POST", {
                        versionId: r.versionId,
                      });
                      message("已套用改寫並建立修訂版本，可在下方查看及還原。");
                    } catch {}
                  }}
                >
                  接受這項改寫
                </button>
                <button
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await mutate(`rewrites/${r.id}/reject`, "POST", {
                        versionId: r.versionId,
                      });
                      message("已拒絕提案，履歷未變更。");
                    } catch {}
                  }}
                >
                  拒絕提案
                </button>
              </div>
            )}
          </article>
        ))
      ) : (
        <Empty title="尚未產生改寫">
          <p>先選一個段落。檢查通過並經你接受後，才會套用。</p>
        </Empty>
      )}
      <section className={s.panel}>
        <h2>目前履歷 · {current ? "使用者已接受／還原的版本" : "原始版本"}</h2>
        <pre className={s.sourceText}>{current?.text || version.text}</pre>
        <h3>版本紀錄</h3>
        {revisions.length ? (
          <ol>
            {revisions
              .slice()
              .reverse()
              .map((r) => (
                <li key={r.id}>
                  <div className={s.row}>
                    <span>
                      {r.restoredFromId ? "還原修訂" : "接受改寫"} ·{" "}
                      {new Date(r.createdAt).toLocaleString("zh-TW")}
                      {r.id === current?.id && " · 目前版本"}
                    </span>
                    <button
                      disabled={busy}
                      onClick={async () => {
                        try {
                          await mutate(
                            `resume-revisions/${r.id}/restore`,
                            "POST",
                            { currentRevisionId: current?.id },
                          );
                          message("已建立還原版本，原始事實證據維持不變。");
                        } catch {}
                      }}
                    >
                      還原至此修訂之前
                    </button>
                  </div>
                </li>
              ))}
          </ol>
        ) : (
          <p className={s.muted}>
            尚無修訂。接受後仍可還原，已接受文字不會自動成為新事實來源。
          </p>
        )}
      </section>
      {preview !== null && (
        <Dialog title="本次改寫模型輸入" close={() => setPreview(null)}>
          <pre className={s.code}>{JSON.stringify(preview, null, 2)}</pre>
        </Dialog>
      )}
    </>
  );
}
