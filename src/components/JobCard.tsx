"use client";
import Link from "next/link";
import type { Document } from "@/domain/types";
import { statusLabels } from "@/domain/types";
import { useApp } from "./AppContext";
import { jobProgress } from "./job-progress";
import s from "./workbench.module.css";

export function JobCard({ job, resume, edit, remove }: {
  job: Document; resume?: Document; edit: (document: Document) => void; remove: (document: Document) => void;
}) {
  const { data, mutate } = useApp();
  if (!data) return null;
  const { step, analysis, review, stale } = jobProgress(data, job, resume);
  const batch = data.batches?.filter((b) => b.resumeId === resume?.id && b.resumeVersionId === resume?.versionId && b.mode === data.settings.mode).at(-1);
  const entry = batch?.jobs.find((j) => j.jobId === job.id && j.versionId === job.versionId);
  const processing = batch?.status === "running" && entry?.status === "processing";
  const failed = entry?.status === "failed" && step !== "complete";
  const status = processing ? "正在比對" : failed ? "比對失敗" : step === "complete" ? "已有比對結果" : stale ? "結果已過期" : "等待整批比對";
  const detail = processing ? "系統正在提取條件並比對履歷，不需要逐張操作。" : failed ? entry?.error : step === "complete" ? "已與目前履歷逐項比對，查看理由、證據與缺口。" : stale ? "資料已變更，請更新整份職缺清單的比對。" : "核對履歷後，系統會自動處理這份職缺。";
  return <article className={s.card}>
    <div className={s.row}>
      <span className={s.eyebrow}>{job.company || "公司未提供"}</span>
      <button aria-label={job.favorite ? `取消收藏 ${job.title}` : `收藏 ${job.title}`}
        aria-pressed={job.favorite} onClick={() => void mutate(`jobs/${job.id}`, "PATCH", {
          revision: job.revision, favorite: !job.favorite,
        }).catch(() => {})}>{job.favorite ? "★ 已收藏" : "☆ 收藏"}</button>
    </div>
    <h3>{job.title}</h3>
    <p className={s.muted}>{job.location || "地點未提供"} · {job.workMode}</p>
    <div className={s.jobProgress}>
      <span className={`${s.badge} ${step === "complete" ? s.supported : step === "stale" ? s.needs_confirmation : ""}`}>{status}</span>
      <p>{detail}</p>
      {stale && step !== "stale" && <p className={s.muted}>先前的比對結果已過期。</p>}
      {step === "complete" && analysis && <ul className={s.matchSummary} aria-label="目前履歷的比對摘要">
        {Object.entries(statusLabels).map(([key, label]) => <li key={key}>
          {label} <strong>{analysis.items.filter((i) => !i.excluded && i.status === key).length}</strong>
        </li>)}
      </ul>}
    </div>
    <div className={s.actions}>
      <Link className={`${s.button} ${s.primary}`} href={`/analysis/${job.id}`}>查看比對結果</Link>
    </div>
    <details className={s.secondaryActions}>
      <summary>職缺原文與管理</summary>
      <div className={s.actions}>
        {review && step !== "job_review" && <Link className={s.button} href={`/review/${job.id}`}>查看／修正職缺條件</Link>}
        {analysis && step !== "complete" && <Link className={s.button} href={`/analysis/${job.id}`}>查看先前比對</Link>}
        <button onClick={() => edit(job)}>查看／編輯原文</button>
        <button className={s.quiet} onClick={() => remove(job)}>刪除</button>
      </div>
    </details>
  </article>;
}
