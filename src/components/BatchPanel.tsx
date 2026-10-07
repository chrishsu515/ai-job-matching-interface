"use client";
import Link from "next/link";
import { useApp } from "./AppContext";
import { documentReview, jobProgress } from "./job-progress";
import s from "./workbench.module.css";

export function BatchPanel() {
  const { data, selectedResumeId, startBatch, busy } = useApp();
  if (!data) return null;
  const resume = data.documents.find((d) => d.id === selectedResumeId);
  const review = documentReview(data, resume);
  const jobs = data.documents.filter((d) => d.kind === "job");
  const batch = data.batches?.filter((b) => b.resumeId === resume?.id && b.resumeVersionId === resume?.versionId && b.mode === data.settings.mode).at(-1);
  const completed = jobs.filter((j) => jobProgress(data, j, resume).step === "complete").length;
  const failed = batch?.jobs.filter((j) => j.status === "failed").length || 0;
  return <section className={s.batchPanel} aria-labelledby="batch-title">
    <div className={s.row}>
      <div><h2 id="batch-title">一次比對，查看所有職缺結果</h2>
        <p>履歷核對完成後，自動提取每份職缺的條件並比對。搜尋與篩選不會縮小分析範圍。</p></div>
      <button className={s.primary} disabled={!review?.confirmed || !jobs.length || busy || !data.settings.ready}
        onClick={() => void startBatch(selectedResumeId).catch(() => {})}>
        {completed || batch ? "更新全部職缺比對" : "比對全部職缺"}
      </button>
    </div>
    <ol className={s.batchSteps} aria-label="整批比對流程">
      <li><strong>1．核對一次履歷</strong><span>{review?.confirmed ? "已確認，可用於所有職缺" : "先在上方整理並核對履歷"}</span></li>
      <li><strong>2．自動比對全部職缺</strong><span>系統依序處理 {jobs.length} 份，不需逐張提取或分析</span></li>
      <li><strong>3．查看結果與缺口</strong><span>每張卡片都從「查看比對結果」進入</span></li>
    </ol>
    <p className={s.batchCount} role="status">已完成 {completed}／{jobs.length} 份{failed ? ` · ${failed} 份失敗` : ""}{batch?.status === "running" ? " · 正在依序比對" : ""}</p>
    {batch && <p className={batch.status === "interrupted" || batch.status === "cancelled" || failed ? s.warning : s.muted}>{batch.stage}</p>}
    {resume && !review?.confirmed && <Link href={`/review/${resume.id}`}>核對履歷，確認後自動開始整批比對</Link>}
    <details><summary>分析與費用說明</summary><p>全新清單每份職缺通常需要一次條件提取、一次配對。已驗證且未變更的結果會沿用；失敗項目可按上方按鈕重新處理。真實模式會依序送出所有職缺的必要文字，取消仍可能計費。AI 提取的條件會標示尚未人工核對，之後可在結果頁修正。</p></details>
  </section>;
}
