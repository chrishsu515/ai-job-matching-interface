"use client";
import Link from "next/link";
import { useState } from "react";
import { AppProvider, useApp } from "./AppContext";
import { SourcePanel } from "./primitives";
import { Home } from "./Home";
import { ReviewView } from "./ReviewView";
import { AnalysisView } from "./AnalysisView";
import { RewriteView } from "./RewriteView";
import { CompareView } from "./CompareView";
import { SettingsView } from "./SettingsView";
import s from "./workbench.module.css";
function Shell({ view, id }: { view: string; id?: string }) {
  const app = useApp();
  const [retryOpen, setRetryOpen] = useState(false);
  return (
    <>
      <a className={s.skip} href="#main">
        跳到主要內容
      </a>
      <header className={s.header}>
        <Link href="/" className={s.brand}>
          <span className={s.logo} aria-hidden="true">
            ↗
          </span>
          <span>
            求職證據工作台<small>AI 求職配對介面 · 個人作品</small>
          </span>
        </Link>
        <nav aria-label="主要導覽">
          <Link href="/" aria-current={view === "home" ? "page" : undefined}>
            工作台
          </Link>
          <Link
            href="/compare"
            aria-current={view === "compare" ? "page" : undefined}
          >
            職缺比較
          </Link>
          <Link
            href="/settings"
            aria-current={view === "settings" ? "page" : undefined}
          >
            資料與用量
          </Link>
        </nav>
        <span className={s.mode}>
          {!app.data
            ? "正在讀取設定"
            : app.data.settings.mode === "real"
              ? "真實 xAI 模式"
              : "固定範例 · 非真實 AI"}
        </span>
      </header>
      <main id="main" className={s.main}>
        <div className={s.localNote}>
          本機保存 · 每項判斷可核對原文 · 不使用整體配對分數
        </div>
        {app.error && (
          <div className={s.error} role="alert">
            <strong>操作未完成</strong>
            <p>{app.error}</p>
            <div className={s.actions}>
              {app.retry && !app.busy && (
                <button onClick={() => setRetryOpen(true)}>重試說明</button>
              )}
              <button onClick={app.dismissError}>收起訊息</button>
              <button onClick={() => app.refresh().catch(() => {})}>
                重新讀取
              </button>
            </div>
          </div>
        )}
        {retryOpen && (
          <div className={s.warning}>
            <p>手動重試會建立新的模型請求。上一個請求即使中斷也可能已計費。</p>
            <button
              onClick={() => {
                setRetryOpen(false);
                if (app.retry) void app.run(app.retry);
              }}
            >
              確認重試
            </button>
            <button onClick={() => setRetryOpen(false)}>返回</button>
          </div>
        )}
        {app.notice && (
          <p className={s.notice} role="status">
            {app.notice}
          </p>
        )}
        {app.busy && (
          <div className={s.progress} role="status">
            <span className={s.spinner} aria-hidden="true" />
            <span>{app.stage}。結果通過驗證後才會顯示。</span>
            <button onClick={() => void app.cancel()}>取消執行</button>
          </div>
        )}
        {!app.data ? (
          <section className={s.empty}>
            <h1>正在讀取本機工作區</h1>
            <p>確認模式與資料位置後顯示內容。</p>
          </section>
        ) : (
          <>
            {!app.data.settings.ready && (
              <p className={s.error} role="alert">
                {app.data.settings.reason} · 請檢查根目錄設定檔。
              </p>
            )}
            {view === "home" && <Home />}
            {view === "review" && <ReviewView id={id || ""} />}
            {view === "analysis" && <AnalysisView id={id || ""} />}
            {view === "rewrite" && <RewriteView id={id || ""} />}
            {view === "compare" && <CompareView />}
            {view === "settings" && <SettingsView />}
          </>
        )}
      </main>
      <footer className={s.footer}>
        原文是依據；模型整理是建議。缺少履歷描述不代表沒有能力。
      </footer>
      <SourcePanel />
    </>
  );
}
export function Workbench(props: { view: string; id?: string }) {
  return (
    <AppProvider>
      <Shell {...props} />
    </AppProvider>
  );
}
