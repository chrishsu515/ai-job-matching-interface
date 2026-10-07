"use client";
import { useEffect, useState } from "react";
import type { Usage } from "@/domain/types";
import { taskLabels } from "@/domain/types";
import { useApp, request } from "./AppContext";
import { Dialog } from "./primitives";
import s from "./workbench.module.css";
export function SettingsView() {
  const { data, mutate, busy, message } = useApp();
  const [usage, setUsage] = useState<Usage[]>([]);
  const [clear, setClear] = useState<"jobs" | "all" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    request("usage")
      .then(setUsage)
      .catch((e) => setError(e.message));
  }, [data]);
  if (!data) return null;
  const settings = data.settings;
  const billed = usage.reduce(
    (sum, u) =>
      sum + (u.billedTicks === null ? 0 : Number(u.billedTicks) / 1e10),
    0,
  );
  const unknown = usage.filter((u) => u.billedTicks === null).length;
  async function clearData() {
    setClearing(true);
    try {
      await mutate("local-data", "DELETE", {
        confirm: confirmation,
        all: clear === "all",
      });
      setClear(null);
      setConfirmation("");
      message("選定的本機資料已清除；設定檔與供應商保留資料未刪除。");
    } catch {
    } finally {
      setClearing(false);
    }
  }
  return (
    <>
      <div className={s.pageHeading}>
        <div>
          <p className={s.eyebrow}>本機資料、安全邊界與實際請求紀錄</p>
          <h1>資料與模型用量</h1>
          <p>透明顯示保存位置、傳送範圍與實際費用。未知費用不當作零。</p>
        </div>
      </div>
      <section className={s.panel}>
        <h2>目前模式與設定</h2>
        <dl className={s.definition}>
          <dt>模式</dt>
          <dd>
            {settings.mode === "real"
              ? "真實 xAI，會產生 API 費用"
              : "固定範例，不呼叫真實模型"}
          </dd>
          <dt>模型</dt>
          <dd>{settings.model}</dd>
          <dt>金鑰狀態</dt>
          <dd>
            {settings.ready
              ? "設定完整（權限仍以真實呼叫為準）"
              : settings.reason}
          </dd>
          <dt>設定位置</dt>
          <dd>專案根目錄 .env（僅伺服器讀取，不提供瀏覽器編輯金鑰）</dd>
          <dt>資料位置</dt>
          <dd>
            <code className={s.path}>{settings.dataDir}</code>
          </dd>
          <dt>保存方式</dt>
          <dd>
            本機 SQLite（單檔資料庫）；直到主動刪除。瀏覽器不另外保存完整履歷。
          </dd>
        </dl>
        <p>
          付費並行一個、每分鐘最多六個實際請求；單次長度、逾時及重試均有上限。沒有每日／每月金額上限。
        </p>
      </section>
      <section className={s.panel}>
        <h2>哪些資料會送往模型？</h2>
        <ul>
          <li>解析：目前文件允許分析的段落。</li>
          <li>配對：人工確認事實、目標條件及必要的原文引用。</li>
          <li>改寫與獨立核查：選定段落、相關事實及目標條件。</li>
        </ul>
        <p>
          不傳其他職缺、完整歷史、設定或金鑰。不使用搜尋、工具、檔案上傳。原文只當分析資料，不能覆寫系統規則。
        </p>
        <p>
          使用 store=false（不保存供應商對話）。xAI
          API（模型服務介面）的稽核政策可能保留資料三十天；本機刪除不等於供應商零保留。
          <a
            href="https://docs.x.ai/developers/faq/security"
            target="_blank"
            rel="noreferrer"
          >
            查看官方政策
          </a>
        </p>
        <p>
          服務只綁本機回環位址，拒絕跨來源寫入，並使用本機工作階段。這不是公開多使用者服務。
        </p>
      </section>
      <section className={s.panel}>
        <h2>模型請求用量</h2>
        {error && <p role="alert">{error}</p>}
        <div className={s.summary}>
          <div>
            <strong>{usage.length}</strong>實際模型請求
          </div>
          <div>
            <strong>{new Set(usage.map((u) => u.runId)).size}</strong>付費任務
          </div>
          <div>
            <strong>US${billed.toFixed(6)}</strong>已知實際費用
          </div>
          <div>
            <strong>{unknown}</strong>費用未知請求
          </div>
        </div>
        <p className={s.muted}>
          固定範例不計入。失敗、重試及被驗證器阻擋的已發生費用照樣保留。
        </p>
        {usage.length ? (
          <div className={s.tableScroll}>
            <table>
              <caption>每次請求的實測紀錄（美元）</caption>
              <thead>
                <tr>
                  <th>任務／時間</th>
                  <th>模型／結果</th>
                  <th>輸入／快取／輸出 Token</th>
                  <th>耗時／首內容</th>
                  <th>實際／估算費用</th>
                </tr>
              </thead>
              <tbody>
                {usage
                  .slice()
                  .reverse()
                  .map((u) => (
                    <tr key={u.id}>
                      <td>
                        {taskLabels[u.task]}
                        <small>
                          {new Date(u.createdAt).toLocaleString("zh-TW")}
                        </small>
                      </td>
                      <td>
                        {u.returnedModel || u.model}
                        <small>
                          {
                            {
                              completed: "格式通過",
                              invalid: "驗證失敗",
                              failed: "執行失敗",
                              cancelled: "取消",
                            }[u.result]
                          }
                        </small>
                      </td>
                      <td>
                        {u.inputTokens ?? "未知"}／{u.cachedTokens ?? "未知"}／
                        {u.outputTokens ?? "未知"}
                        <small>推理 {u.reasoningTokens ?? "未知"}</small>
                      </td>
                      <td>
                        {(u.durationMs / 1000).toFixed(2)} 秒
                        <small>
                          {u.firstContentMs === null
                            ? "首內容未知"
                            : (u.firstContentMs / 1000).toFixed(2) + " 秒"}
                        </small>
                      </td>
                      <td>
                        {u.billedTicks === null
                          ? "未知"
                          : (Number(u.billedTicks) / 1e10).toFixed(6)}
                        <small>
                          估算{" "}
                          {u.estimatedUsd === null
                            ? "未知"
                            : u.estimatedUsd.toFixed(6)}
                        </small>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>目前沒有真實模型請求紀錄。</p>
        )}
      </section>
      <section className={s.panel}>
        <h2>執行狀態與失敗紀錄</h2>
        {data.runs
          .slice()
          .reverse()
          .map((r) => (
            <div className={s.runRecord} key={r.id}>
              <strong>
                {taskLabels[r.task]} ·{" "}
                {
                  {
                    generating: "生成中",
                    validating: "驗證中",
                    completed: "完成",
                    failed: "失敗",
                    cancelled: "已取消",
                  }[r.status]
                }
              </strong>
              <p className={s.muted}>
                {r.mode === "real" ? "真實模型" : "固定範例"} ·{" "}
                {new Date(r.createdAt).toLocaleString("zh-TW")}
              </p>
              {r.error && <p>{r.error.message}</p>}
              {(r.status === "generating" || r.status === "validating") && (
                <button
                  onClick={() =>
                    void mutate(`runs/${r.id}/cancel`, "POST", {}).catch(
                      () => {},
                    )
                  }
                >
                  取消原執行
                </button>
              )}
            </div>
          ))}
      </section>
      <section className={s.panel}>
        <h2>清除本機資料</h2>
        <p>
          清除先取消執行，再刪除來源、修訂、分析、快取及 SQLite
          日誌。遲到回應不能重建資料。不宣稱抹除作業系統備份或磁碟底層殘留；.env
          不會刪除。
        </p>
        <div className={s.actions}>
          <button disabled={busy} onClick={() => setClear("jobs")}>
            清除求職資料
          </button>
          <button
            className={s.danger}
            disabled={busy}
            onClick={() => setClear("all")}
          >
            清除全部本機紀錄
          </button>
        </div>
      </section>
      {clear && (
        <Dialog title="確認清除本機資料" close={() => setClear(null)}>
          <p>
            {clear === "all"
              ? "全部履歷、職缺、修訂、分析及用量紀錄將刪除。"
              : "求職資料將刪除，保留不含履歷內容的費用紀錄。"}
            設定檔保留。
          </p>
          <label>
            輸入「清除」
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
          </label>
          <div className={s.actions}>
            <button onClick={() => setClear(null)}>返回</button>
            <button
              className={s.danger}
              disabled={confirmation !== "清除" || clearing}
              onClick={() => void clearData()}
            >
              {clearing ? "清除中…" : "確認清除"}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
