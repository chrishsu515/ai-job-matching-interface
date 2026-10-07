"use client";
import { useState } from "react";
import type { Document } from "@/domain/types";
import { useApp } from "./AppContext";
import { DocumentForm } from "./DocumentForm";
import { Dialog, Empty } from "./primitives";
import { ResumeWorkspace } from "./ResumeWorkspace";
import { JobCard } from "./JobCard";
import { BatchPanel } from "./BatchPanel";
import { documentReview, jobProgress } from "./job-progress";
import s from "./workbench.module.css";
export function Home() {
  const { data, mutate, busy, message, selectedResumeId } = useApp();
  const [form, setForm] = useState<{
    kind: Document["kind"];
    document?: Document;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [favorite, setFavorite] = useState(false);
  const [workMode, setWorkMode] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("");
  const [deletion, setDeletion] = useState<Document | null>(null);
  if (!data) return null;
  const resume = data.documents.find((d) => d.id === selectedResumeId);
  const jobs = data.documents.filter((d) => d.kind === "job");
  const filtered = jobs.filter((d) => {
    const r = documentReview(data, d);
    const progress = jobProgress(data, d, resume);
    const text = [
      d.title,
      d.company,
      data.versions.find((v) => v.id === d.versionId)?.text,
      ...(r?.items.map((i) => i.label) || []),
    ]
      .join(" ")
      .toLocaleLowerCase();
    return (
      text.includes(query.toLocaleLowerCase()) &&
      (!favorite || d.favorite) &&
      (!workMode || d.workMode === workMode) &&
      (!location || d.location === location) &&
      (!status ||
        (status === "pending" ? progress.step !== "complete" && !progress.stale :
          status === "complete" ? progress.step === "complete" :
            status === "stale" ? !!progress.stale : progress.step === "job_review"))
    );
  });
  async function seed() {
    try {
      await mutate("seed", "POST", {});
      message("已載入合成履歷與職缺。核對一次履歷後，系統自動比對全部職缺。");
    } catch {}
  }
  return (
    <>
      <div className={s.pageHeading}>
        <div>
          <p className={s.eyebrow}>核對一次履歷 → 自動比對全部職缺 → 查看證據與缺口</p>
          <h1>用我的履歷，逐項比對職缺</h1>
          <p>看清楚哪些要求已有證據、哪些需要補充，再決定如何改寫履歷。</p>
        </div>
        <button onClick={() => void seed()} disabled={busy}>
          載入合成範例
        </button>
      </div>
      <ResumeWorkspace edit={(document) => setForm({ kind: document.kind, document })}
        remove={setDeletion} add={(kind) => setForm({ kind })} />
      <BatchPanel />
      <section aria-labelledby="jobs-title">
        <div className={s.row}>
          <div><p className={s.eyebrow}>全部職缺的比對結果</p><h2 id="jobs-title">
            職缺清單 <span className={s.count}>{jobs.length}</span>
          </h2></div>
          <button onClick={() => setForm({ kind: "job" })}>＋ 貼上職缺</button>
        </div>
        <p className={s.jobContext}>{resume ? <>目前比對履歷：<strong>{resume.title}</strong>。每張卡片的狀態與結果都對應這份履歷。</> : "加入履歷後，這裡會顯示每個職缺的比對進度。"}</p>
        <div className={s.filters}>
          <label className={s.search}>
            搜尋
            <input
              type="search"
              placeholder="職稱、公司、技能或原文"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            工作方式
            <select
              value={workMode}
              onChange={(e) => setWorkMode(e.target.value)}
            >
              <option value="">全部方式</option>
              {[...new Set(jobs.map((j) => j.workMode))].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            地點
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            >
              <option value="">全部地點</option>
              {[...new Set(jobs.map((j) => j.location))]
                .filter(Boolean)
                .map((v) => (
                  <option key={v}>{v}</option>
                ))}
            </select>
          </label>
          <label>
            比對狀態
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">全部狀態</option>
              <option value="pending">尚未完成比對</option>
              <option value="complete">已有比對結果</option>
              <option value="stale">結果已過期</option>
            </select>
          </label>
          <label className={s.checkRow}>
            <input
              type="checkbox"
              checked={favorite}
              onChange={(e) => setFavorite(e.target.checked)}
            />
            僅收藏
          </label>
        </div>
        {filtered.length ? (
          <div className={s.grid}>{filtered.map((job) => <JobCard key={job.id} job={job} resume={resume}
            edit={(document) => setForm({ kind: document.kind, document })} remove={setDeletion} />)}</div>
        ) : (
          <Empty
            title={jobs.length ? "沒有符合篩選的職缺" : "貼上想應徵的職缺"}
          >
            <p>
              {jobs.length
                ? "調整搜尋或篩選即可恢復清單。"
                : "以自己提供的文字分析，不使用爬蟲。"}
            </p>
          </Empty>
        )}
      </section>
      {form && <DocumentForm {...form} close={() => setForm(null)} />}
      {deletion && (
        <Dialog title="刪除文件與相關分析" close={() => setDeletion(null)}>
          <p>
            刪除「{deletion.title}
            」及依賴它的核對、分析、改寫與快取。無內容的用量紀錄保留。
          </p>
          <div className={s.actions}>
            <button onClick={() => setDeletion(null)}>返回</button>
            <button
              className={s.danger}
              onClick={async () => {
                try {
                  await mutate(`documents/${deletion.id}`, "DELETE", {});
                  setDeletion(null);
                  message("文件與依賴結果已刪除。");
                } catch {}
              }}
            >
              確認刪除
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
