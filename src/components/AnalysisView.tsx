"use client";
import Link from "next/link";
import { useState } from "react";
import { statusLabels, categoryLabels } from "@/domain/types";
import { useApp, request } from "./AppContext";
import { Dialog, Empty, References } from "./primitives";
import s from "./workbench.module.css";
export function AnalysisView({ id }: { id: string }) {
  const { data, run, startBatch, busy, selectedResumeId, selectResume } = useApp();
  const [filter, setFilter] = useState("");
  const [preview, setPreview] = useState<unknown>(null);
  if (!data) return null;
  const job = data.documents.find((d) => d.id === id && d.kind === "job");
  const resumes = data.documents.filter((d) => d.kind === "resume");
  if (!job)
    return (
      <Empty title="找不到職缺">
        <Link href="/">返回工作台</Link>
      </Empty>
    );
  const selected = selectedResumeId;
  const resume = data.documents.find((d) => d.id === selected);
  const reviewFor = (docId: string) =>
    data.reviews
      .filter(
        (r) =>
          r.documentId === docId &&
          r.versionId ===
            data.documents.find((d) => d.id === docId)?.versionId &&
          r.mode === data.settings.mode,
      )
      .at(-1);
  const jobReview = reviewFor(job.id);
  const resumeReview = reviewFor(selected);
  const analysis = data.analyses
    .filter(
      (a) =>
        a.jobId === id &&
        a.resumeId === selected &&
        a.mode === data.settings.mode,
    )
    .at(-1);
  const ready = !!jobReview && resumeReview?.confirmed;
  const input = { task: "match" as const, resumeId: selected, jobId: id };
  return (
    <>
      <Link href="/">← 工作台</Link>
      <div className={s.pageHeading}>
        <div>
          <p className={s.eyebrow}>整批比對結果 · 職缺明細</p>
          <h1>{job.title}</h1>
          <p>{job.company} · 先看必要條件，再核對證據與缺口。</p>
        </div>
        <Link className={s.button} href={`/review/${id}`}>
          核對職缺條件
        </Link>
      </div>
      <div className={s.toolbar}>
        <label>
          比對的履歷
          <select
            value={selected}
            onChange={(e) => selectResume(e.target.value)}
          >
            <option value="" disabled>
              請選擇
            </option>
            {resumes.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </label>
        <button
          className={s.primary}
          disabled={!resumeReview?.confirmed || busy}
          onClick={() => analysis && !analysis.stale ? void run(input) : void startBatch(selected).catch(() => {})}
        >
          {analysis && !analysis.stale ? "沿用／重新查詢分析" : "更新全部職缺比對"}
        </button>
        <button
          disabled={!ready || busy}
          onClick={() =>
            void request("preview", "POST", input)
              .then(setPreview)
              .catch(() => {})
          }
        >
          預覽傳送範圍
        </button>
        {resume && jobReview?.confirmed && (
          <Link className={s.button} href={`/rewrite/${id}?resume=${selected}`}>
            產生履歷改寫
          </Link>
        )}
      </div>
      {!ready && (
        <div className={s.warning}>
          <p>尚無目前履歷的有效比對結果。核對一次履歷後，系統會自動處理整份職缺清單，不需要在這裡逐筆分析。</p>
          <div className={s.actions}>
            {resume && <Link href={`/review/${selected}`}>核對履歷</Link>}
            <Link href="/">返回整批比對進度</Link>
          </div>
        </div>
      )}
      {analysis && !analysis.stale && ready ? (
        <>
          <div className={analysis.stale ? s.warning : s.notice}>
            {analysis.stale
              ? "資料或核對版本已變更，這份分析已過期。請主動重新分析。"
              : "逐項判斷已通過引用驗證"}{" "}
            · {analysis.mode === "real" ? "既有真實分析" : "固定範例結果"} ·{" "}
            {new Date(analysis.createdAt).toLocaleString("zh-TW")}
          </div>
          {!jobReview?.confirmed && <div className={s.warning}>職缺條件由 AI 提取，尚未人工核對。結果是供你核對的建議；可從「核對職缺條件」修正來源與要求，核對後再產生改寫。</div>}
          <div className={s.summary}>
            {Object.entries(statusLabels).map(([status, label]) => (
              <button
                key={status}
                aria-pressed={filter === status}
                onClick={() => setFilter((v) => (v === status ? "" : status))}
              >
                <strong>
                  {
                    analysis.items.filter(
                      (i) => i.status === status && !i.excluded,
                    ).length
                  }
                </strong>
                {label}
              </button>
            ))}
          </div>
          <p className={s.muted}>
            數量是逐項狀態統計，沒有整體配對分數。缺少描述不代表沒有能力。
          </p>
          {(["required", "preferred", "unspecified"] as const).map(
            (category) => {
              const requirements =
                jobReview?.items.filter((r) => r.category === category) || [];
              const rows = requirements.filter(
                (r) =>
                  !filter ||
                  analysis.items.find((i) => i.requirementId === r.id)
                    ?.status === filter,
              );
              return (
                rows.length > 0 && (
                  <section key={category}>
                    <h2>{categoryLabels[category]}</h2>
                    <div className={s.stack}>
                      {rows.map((r) => {
                        const item = analysis.items.find(
                          (i) => i.requirementId === r.id,
                        );
                        return (
                          item && (
                            <article className={s.condition} key={r.id}>
                              <div className={s.conditionHead}>
                                <h3>{r.label}</h3>
                                <span
                                  className={`${s.badge} ${s[item.status]}`}
                                >
                                  {item.excluded
                                    ? "已排除非職能條件"
                                    : statusLabels[item.status]}
                                </span>
                              </div>
                              <div className={s.evidenceGrid}>
                                <div>
                                  <p className={s.eyebrow}>
                                    模型判斷 ·{" "}
                                    {item.guardrail && "已套用程式保護"}
                                  </p>
                                  <p>{item.reason}</p>
                                  {item.clarifyingQuestion && (
                                    <p>
                                      <strong>待確認：</strong>
                                      {item.clarifyingQuestion}
                                    </p>
                                  )}
                                  {item.suggestedAction && (
                                    <p className={s.nextStep}>
                                      <strong>可以補充：</strong>
                                      {item.suggestedAction}
                                    </p>
                                  )}
                                </div>
                                <div className={s.evidence}>
                                  <p className={s.eyebrow}>履歷證據</p>
                                  {item.evidenceRefs.length ? (
                                    <>
                                      {item.evidenceRefs.map((ref, i) => (
                                        <blockquote key={i}>
                                          {ref.quote}
                                        </blockquote>
                                      ))}
                                      <References refs={item.evidenceRefs} />
                                    </>
                                  ) : (
                                    <p className={s.muted}>
                                      沒有可核對的履歷引用。
                                    </p>
                                  )}
                                  <p className={s.eyebrow}>職缺原文</p>
                                  <References refs={r.refs} />
                                </div>
                              </div>
                            </article>
                          )
                        );
                      })}
                    </div>
                  </section>
                )
              );
            },
          )}
        </>
      ) : (
        <Empty title={analysis?.stale ? "這份結果已過期" : "尚未完成這份職缺的比對"}>
          <p>請在工作台查看整批進度，或更新全部職缺比對。切換頁面不會呼叫模型。</p>
          <Link href="/">返回工作台</Link>
        </Empty>
      )}
      {preview !== null && (
        <Dialog title="本次模型輸入預覽" close={() => setPreview(null)}>
          <p>只傳確認事實、條件與必要原文。沒有金鑰、其他職缺及修訂歷史。</p>
          <pre className={s.code}>{JSON.stringify(preview, null, 2)}</pre>
        </Dialog>
      )}
    </>
  );
}
