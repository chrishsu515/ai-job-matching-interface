"use client";
import { useMemo, useState, type FormEvent } from "react";
import type { Document } from "@/domain/types";
import { segmentText } from "@/domain/sources";
import { useApp } from "./AppContext";
import { Dialog } from "./primitives";
import s from "./workbench.module.css";
export function DocumentForm({
  kind,
  document,
  close,
}: {
  kind: Document["kind"];
  document?: Document;
  close: () => void;
}) {
  const { data, mutate, message } = useApp();
  const source = data?.versions.find((v) => v.id === document?.versionId);
  const [title, setTitle] = useState(document?.title || "");
  const [text, setText] = useState(source?.original || "");
  const [company, setCompany] = useState(document?.company || "");
  const [location, setLocation] = useState(document?.location || "");
  const [workMode, setWorkMode] = useState(document?.workMode || "未提供");
  const [excluded, setExcluded] = useState<string[]>(
    source?.segments
      .map((v, i) => (v.excluded ? String(i) : ""))
      .filter(Boolean) || [],
  );
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const segments = useMemo(
    () => segmentText(text.replace(/\r\n?/g, "\n"), "preview"),
    [text],
  );
  const limit = kind === "job" ? 8000 : 12000;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const value = {
        kind,
        title,
        text,
        company,
        location,
        workMode,
        excludedSegmentIds: excluded,
        consent,
      };
      await mutate(
        document ? `documents/${document.id}` : "documents",
        document ? "PUT" : "POST",
        document ? { document: value, revision: document.revision } : value,
      );
      message(
        document
          ? "已保存新原文版本；舊核對與分析須重新進行。"
          : "已保存在本機，尚未送往模型。",
      );
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失敗。");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      title={`${document ? "更新" : "新增"}${kind === "job" ? "職缺" : kind === "supplement" ? "補充事實來源" : "履歷"}`}
      close={close}
    >
      <form onSubmit={submit} className={s.form}>
        <label>
          名稱
          <input
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：我的履歷／前端工程師"
          />
        </label>
        {kind === "job" && (
          <div className={s.formColumns}>
            <label>
              公司
              <input
                maxLength={120}
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </label>
            <label>
              地點
              <input
                maxLength={120}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </label>
            <label>
              工作方式
              <select
                value={workMode}
                onChange={(e) => setWorkMode(e.target.value)}
              >
                {["未提供", "現場", "遠端", "混合"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        <label>
          使用者提供的原文
          <textarea
            rows={10}
            required
            maxLength={limit}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setExcluded([]);
            }}
          />
        </label>
        <p className={s.muted}>
          {text.length.toLocaleString()}／{limit.toLocaleString()} 字元 ·
          不會靜默截斷。
        </p>
        <details>
          <summary>預覽模型可收到的段落，排除個資或無關內容</summary>
          <p>
            排除段落仍保留在本機，但不會傳送或作為模型證據。修改文字後需重新選擇排除項目。
          </p>
          {segments.map((segment, i) => (
            <label className={s.checkRow} key={segment.id}>
              <input
                type="checkbox"
                checked={excluded.includes(String(i))}
                onChange={(e) =>
                  setExcluded((v) =>
                    e.target.checked
                      ? [...v, String(i)]
                      : v.filter((x) => x !== String(i)),
                  )
                }
              />
              <span>
                排除第 {segment.line} 行：{segment.text}
              </span>
            </label>
          ))}
        </details>
        <label className={s.checkRow}>
          <input
            type="checkbox"
            required
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            同意保存在本機資料庫，直到主動清除。主動按「提取履歷事實」或「提取職缺條件」才會將允許的段落送往目前模型模式。補充來源須在履歷核對時選為引用，不會自動送出。金鑰與其他文件不會一併傳送。
          </span>
        </label>
        {error && <p role="alert">{error}</p>}
        <div className={s.actions}>
          <button type="button" onClick={close}>
            返回
          </button>
          <button className={s.primary} disabled={saving}>
            {saving ? "保存中…" : "保存原文"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
