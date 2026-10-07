"use client";
import Link from "next/link";
import { useState } from "react";
import { categoryLabels, statusLabels } from "@/domain/types";
import { useApp } from "./AppContext";
import { Empty, References } from "./primitives";
import s from "./workbench.module.css";
export function CompareView() {
  const { data, selectedResumeId, selectResume } = useApp();
  const [selected, setSelected] = useState<string[]>([]);
  if (!data) return null;
  const jobs = data.documents.filter((d) => d.kind === "job");
  const resumes = data.documents.filter((d) => d.kind === "resume");
  const resume = selectedResumeId;
  return (
    <>
      <div className={s.pageHeading}>
        <div>
          <p className={s.eyebrow}>並列查看，保留每份職缺的原始條件</p>
          <h1>比較職缺的要求與證據</h1>
          <p>最多三份。相似條件不會強行合併，也不使用排名分數。</p>
        </div>
      </div>
      <div className={s.panel}>
        <label>
          比對履歷
          <select
            value={resume || ""}
            onChange={(e) => selectResume(e.target.value)}
          >
            {resumes.map((r) => (
              <option value={r.id} key={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>選擇職缺（{selected.length}／3）</legend>
          <div className={s.actions}>
            {jobs.map((j) => (
              <label className={s.checkRow} key={j.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(j.id)}
                  disabled={selected.length === 3 && !selected.includes(j.id)}
                  onChange={(e) =>
                    setSelected((v) =>
                      e.target.checked
                        ? [...v, j.id]
                        : v.filter((id) => id !== j.id),
                    )
                  }
                />
                {j.title} · {j.company}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      {selected.length ? (
        <div className={s.compareGrid}>
          {selected.map((id) => {
            const job = jobs.find((j) => j.id === id)!;
            const review = data.reviews
              .filter(
                (r) =>
                  r.documentId === id &&
                  r.versionId === job.versionId &&
                  r.mode === data.settings.mode,
              )
              .at(-1);
            const analysis = data.analyses
              .filter(
                (a) =>
                  a.jobId === id &&
                  a.resumeId === resume &&
                  a.mode === data.settings.mode,
              )
              .at(-1);
            return (
              <section key={id} className={s.panel}>
                <h2>{job.title}</h2>
                <p>
                  {job.company} · {job.workMode}
                </p>
                <Link href={`/analysis/${id}`}>查看／建立分析</Link>
                {!review ? (
                  <p className={s.warning}>尚未整理，不視為不符合。</p>
                ) : (
                  <>
                    {!review.confirmed && (
                      <p className={s.warning}>整理內容尚未人工確認。</p>
                    )}
                    {analysis?.stale && (
                      <p className={s.warning}>分析已過期，請重新核對。</p>
                    )}
                    {review.items.map((r) => {
                      const match = analysis?.items.find(
                        (i) => i.requirementId === r.id,
                      );
                      return (
                        <details className={s.compareItem} key={r.id} open>
                          <summary>{r.label}</summary>
                          <p className={s.eyebrow}>
                            {categoryLabels[r.category || "unspecified"]}
                          </p>
                          <span
                            className={`${s.badge} ${match ? s[match.status] : ""}`}
                          >
                            {match
                              ? match.excluded
                                ? "已排除"
                                : statusLabels[match.status]
                              : "尚未分析"}
                          </span>
                          {match && (
                            <>
                              <p>{match.reason}</p>
                              <References refs={match.evidenceRefs} />
                            </>
                          )}
                          <p className={s.muted}>職缺原文</p>
                          <References refs={r.refs} />
                        </details>
                      );
                    })}
                  </>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <Empty title="先選擇想比較的職缺">
          <p>比較與切換畫面不會呼叫模型。</p>
        </Empty>
      )}
    </>
  );
}
