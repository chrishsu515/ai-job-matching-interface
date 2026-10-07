"use client";
import Link from "next/link";
import type { Document } from "@/domain/types";
import { useApp } from "./AppContext";
import { documentReview } from "./job-progress";
import { Empty } from "./primitives";
import s from "./workbench.module.css";

export function ResumeWorkspace({ edit, remove, add }: {
  edit: (document: Document) => void; remove: (document: Document) => void;
  add: (kind: "resume" | "supplement") => void;
}) {
  const { data, run, busy, selectedResumeId, selectResume } = useApp();
  if (!data) return null;
  const resumes = data.documents.filter((d) => d.kind === "resume");
  const resume = resumes.find((d) => d.id === selectedResumeId);
  const review = documentReview(data, resume);
  const supplements = data.documents.filter((d) => d.kind === "supplement");
  return <section aria-labelledby="resume-title" className={s.resumeWorkspace}>
    <div className={s.row}>
      <div><p className={s.eyebrow}>第一步 · 準備比對依據</p><h2 id="resume-title">我的履歷</h2></div>
      <button onClick={() => add("resume")}>＋ 貼上履歷</button>
    </div>
    <p>這份履歷是所有職缺共用的比對依據。只需核對一次，確認後會自動比對下方整份清單。</p>
    {resume ? <div className={s.resumePanel}>
      <div>
        <label className={s.resumeChoice}>比對的履歷
          <select value={selectedResumeId} onChange={(e) => selectResume(e.target.value)}>
            {resumes.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        </label>
        <article className={s.resumeFacts}>
          <p className={s.eyebrow}>目前用來比對的履歷 · 使用者原文</p>
          <h3>{resume.title}</h3>
          <p className={s.muted}>{review ? review.confirmed ? `已確認 ${review.items.length} 項履歷事實 · 可比對職缺` : `已提取 ${review.items.length} 項履歷事實 · 待你核對` : "尚未提取履歷事實"} · 原文版本 {resume.revision}</p>
          <div className={s.actions}>
            {review ? <Link className={`${s.button} ${s.primary}`} href={`/review/${resume.id}`}>
              {review.confirmed ? "查看／修正履歷事實" : "核對履歷事實"}
            </Link> : <button className={s.primary} disabled={busy || !data.settings.ready}
              onClick={() => void run({ task: "parse_resume", documentId: resume.id })}>提取履歷事實</button>}
            <button onClick={() => edit(resume)}>查看／編輯履歷原文</button>
          </div>
          <details className={s.secondaryActions}><summary>履歷管理</summary><div className={s.actions}>
            {review && !review.confirmed && <button disabled={busy || !data.settings.ready}
              onClick={() => void run({ task: "parse_resume", documentId: resume.id })}>重新提取履歷事實</button>}
            <button className={s.quiet} onClick={() => remove(resume)}>刪除履歷</button>
          </div></details>
        </article>
      </div>
      <section className={s.resumeSources} aria-labelledby="supplement-title">
        <h3 id="supplement-title">補充經歷與作品來源</h3>
        <p className={s.muted}>履歷沒寫到的經歷或作品，可以在這裡補充原文。之後在履歷核對中選為引用，才會用於比對。</p>
        <button onClick={() => add("supplement")}>＋ 補充事實</button>
        {supplements.length ? <details className={s.secondaryActions}>
          <summary>查看補充來源（{supplements.length}）</summary>
          {supplements.map((d) => <article key={d.id} className={s.supplementItem}>
            <h4>{d.title}</h4><p className={s.muted}>使用者補充原文 · 須在核對時選為引用</p>
            <div className={s.actions}><button onClick={() => edit(d)}>查看／編輯來源</button>
              <button className={s.quiet} onClick={() => remove(d)}>刪除來源</button></div>
          </article>)}
        </details> : <p className={s.muted}>尚無補充來源，可直接使用履歷已有的內容。</p>}
      </section>
    </div> : <Empty title="先放入履歷，或從合成範例開始">
      <p>不需要登入、不會投遞。第一次保存前可排除聯絡資訊。</p>
    </Empty>}
  </section>;
}
