"use client";
import Link from "next/link";
import { useState } from "react";
import type { Item, Review, Ref } from "@/domain/types";
import { categoryLabels } from "@/domain/types";
import { useApp } from "./AppContext";
import { Dialog, Empty, References } from "./primitives";
import s from "./workbench.module.css";
export function ReviewView({ id }: { id: string }) {
  const { data, run, busy, mutate, message, selectedResumeId } = useApp();
  if (!data) return null;
  const doc = data.documents.find((d) => d.id === id);
  const version = data.versions.find((v) => v.id === doc?.versionId);
  const review = data.reviews
    .filter(
      (r) =>
        r.documentId === id &&
        r.versionId === version?.id &&
        r.mode === data.settings.mode,
    )
    .at(-1);
  if (!doc || !version)
    return (
      <Empty title="找不到文件">
        <Link href="/">返回工作台</Link>
      </Empty>
    );
  return (
    <>
      <Link href="/">← 工作台</Link>
      <div className={s.pageHeading}>
        <div>
          <p className={s.eyebrow}>
            02 人工核對 · {doc.kind === "job" ? "職缺條件" : "履歷事實"}
          </p>
          <h1>{doc.title}</h1>
          <p>{doc.kind === "job" ? `核對這份職缺的要求，再與「${data.documents.find((d) => d.id === selectedResumeId)?.title || "你的履歷"}」逐項比對。` : "核對這份履歷一次，確認後系統會自動比對清單中所有職缺，不需逐張整理。"}</p>
        </div>
      </div>
      {review ? (
        <ReviewEditor key={review.id + review.revision} review={review} />
      ) : (
        <Empty title={doc.kind === "job" ? "尚未提取這份職缺的條件" : "尚未提取這份履歷的事實"}>
          <button
            disabled={busy}
            onClick={() =>
              void run({
                task: doc.kind === "job" ? "parse_job" : "parse_resume",
                documentId: id,
              })
            }
          >
            {doc.kind === "job" ? "提取職缺條件" : "提取履歷事實"}
          </button>
          <p>
            模型漏抓或服務失敗時，可依原文自行建立核對內容；不算模型解析成功。
          </p>
          <button
            disabled={busy}
            onClick={async () => {
              try {
                await mutate("reviews", "POST", { documentId: id });
                message("已建立人工核對草稿；請新增有來源項目，未呼叫模型。");
              } catch {}
            }}
          >
            自行核對原文（不呼叫模型）
          </button>
        </Empty>
      )}
      <details className={s.panel}>
        <summary>完整使用者原文及排除範圍</summary>
        {version.segments.map((v) => (
          <p className={s.sourceLine} key={v.id}>
            <span className={s.muted}>
              第 {v.line} 行{v.excluded && " · 已排除模型分析"}
            </span>
            <br />
            {v.text}
          </p>
        ))}
      </details>
    </>
  );
}
function ReviewEditor({ review }: { review: Review }) {
  const { data, mutate, message, busy, selectResume, startBatch } = useApp();
  const [items, setItems] = useState<Item[]>(structuredClone(review.items));
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  if (!data) return null;
  const doc = data.documents.find((d) => d.id === review.documentId)!;
  const isJob = doc.kind === "job";
  const dirty = JSON.stringify(items) !== JSON.stringify(review.items);
  async function save(confirmed: boolean) {
    setSaving(true);
    try {
      await mutate(`reviews/${review.id}`, "PUT", {
        revision: review.revision,
        items,
        confirmed,
      });
      if (confirmed && !isJob && data?.documents.some((d) => d.kind === "job")) {
        selectResume(doc.id);
        await startBatch(doc.id);
      }
      message(
        confirmed
          ? isJob ? "已確認核對版本，可進行條件分析。" : "已確認核對版本，正在自動比對全部職缺；返回工作台查看整批進度。"
          : "已保存修正；需要再次確認後才能分析。",
      );
    } catch {
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className={review.confirmed && !dirty ? s.notice : s.warning}>
        {review.confirmed && !dirty ? "已確認的核對版本" : isJob ? "AI 提取的職缺條件 · 尚未人工核對，可先比對" : "待人工確認"} ·{" "}
        {review.origin === "user"
          ? "使用者自行核對 · 非模型解析"
          : review.mode === "real"
            ? "真實模型整理"
            : "固定範例整理"}{" "}
        · 第 {review.revision} 版
      </div>
      {review.warnings.map((w, i) => (
        <p className={s.warning} key={i}>
          {w}
        </p>
      ))}
      {review.conflicts.map((c, i) => (
        <div className={s.warning} key={i}>
          <strong>原文矛盾，需要確認</strong>
          <p>{c.reason}</p>
          <References refs={c.refs} />
        </div>
      ))}
      <div className={s.stack}>
        {items.map((item, index) => (
          <article key={item.id} className={s.reviewRow}>
            <div>
              <span className={s.eyebrow}>
                {isJob
                  ? categoryLabels[item.category || "unspecified"]
                  : item.kind === "experience"
                    ? "工作經歷"
                    : item.kind === "achievement"
                      ? "成果"
                      : "技能"}{" "}
                · {item.edited ? "使用者修正" : "模型整理"}
              </span>
              <h3>{item.label}</h3>
              <p className={s.muted}>
                技能平台：
                {
                  {
                    mobile: "行動",
                    web: "網頁",
                    other: "其他",
                    unknown: "未明示",
                  }[item.platform]
                }{" "}
                · 年資：
                {item.years === null
                  ? "未明示，不推算"
                  : `${item.years} 年（原文明示）`}
              </p>
              <References refs={item.refs} />
            </div>
            <div className={s.actions}>
              <button
                onClick={() => setEditing(item)}
                aria-label={`修正項目 ${index + 1}`}
              >
                修正
              </button>
              <button
                onClick={() => setItems(items.filter((i) => i.id !== item.id))}
                aria-label={`刪除項目 ${index + 1}`}
              >
                移除
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className={s.panel}>
        <p>
          確認表示你已核對文字、分類、技能平台與引用。新事實須先在工作台新增補充來源。
        </p>
        <div className={s.actions}>
          <button
            onClick={() =>
              setEditing({
                id: crypto.randomUUID(),
                label: "",
                kind: isJob ? "requirement" : "skill",
                category: isJob ? "unspecified" : null,
                platform: "unknown",
                years: null,
                refs: [],
                origin: "user",
                edited: true,
              })
            }
          >
            新增有來源項目
          </button>
          <button
            disabled={!dirty || saving || busy}
            onClick={() => void save(false)}
          >
            保存修正
          </button>
          <button
            className={s.primary}
            disabled={!items.length || saving || busy}
            onClick={() => void save(true)}
          >
            {saving ? "保存中…" : isJob ? "確認核對內容" : "確認履歷並比對全部職缺"}
          </button>
          {review.confirmed && !dirty && (
            <Link
              className={s.button}
              href={isJob ? `/analysis/${doc.id}` : "/"}
              onClick={() => { if (!isJob) selectResume(doc.id); }}
            >
              {isJob ? "進入條件分析" : "查看全部職缺結果"}
            </Link>
          )}
        </div>
      </div>
      {editing && (
        <ItemEditor
          key={editing.id}
          item={editing}
          documentId={doc.id}
          isJob={isJob}
          close={() => setEditing(null)}
          save={(item) => {
            setItems((v) =>
              v.some((i) => i.id === item.id)
                ? v.map((i) => (i.id === item.id ? item : i))
                : [...v, item],
            );
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
function ItemEditor({
  item,
  documentId,
  isJob,
  close,
  save,
}: {
  item: Item;
  documentId: string;
  isJob: boolean;
  close: () => void;
  save: (item: Item) => void;
}) {
  const { data } = useApp();
  const [draft, setDraft] = useState(item);
  if (!data) return null;
  const versions = data.documents
    .filter((d) => d.id === documentId || (!isJob && d.kind === "supplement"))
    .flatMap((d) => data.versions.filter((v) => v.id === d.versionId));
  function toggle(ref: Ref, selected: boolean) {
    setDraft((v) => ({
      ...v,
      refs: selected
        ? [...v.refs.filter((r) => r.segmentId !== ref.segmentId), ref]
        : v.refs.filter((r) => r.segmentId !== ref.segmentId),
    }));
  }
  return (
    <Dialog title="修正整理項目與引用" close={close}>
      <form
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault();
          save({ ...draft, origin: "user", edited: true });
        }}
      >
        <label>
          項目文字
          <textarea
            required
            value={draft.label}
            maxLength={2048}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          />
        </label>
        {isJob ? (
          <label>
            條件分類
            <select
              value={draft.category || "unspecified"}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  category: e.target.value as Item["category"],
                })
              }
            >
              {Object.entries(categoryLabels).map(([v, label]) => (
                <option value={v} key={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            事實類型
            <select
              value={draft.kind}
              onChange={(e) =>
                setDraft({ ...draft, kind: e.target.value as Item["kind"] })
              }
            >
              <option value="skill">技能</option>
              <option value="experience">工作經歷</option>
              <option value="achievement">成果</option>
            </select>
          </label>
        )}
        <label>
          平台
          <select
            value={draft.platform}
            onChange={(e) =>
              setDraft({
                ...draft,
                platform: e.target.value as Item["platform"],
              })
            }
          >
            <option value="unknown">未明示</option>
            <option value="mobile">行動</option>
            <option value="web">網頁</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label>
          原文明示年資，未明示請留空
          <input
            type="number"
            min="0"
            max="80"
            value={draft.years ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                years: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </label>
        <fieldset>
          <legend>選擇原文證據（至少一項，最多八項）</legend>
          {versions.map((v) => (
            <div key={v.id}>
              <h3>
                {data.documents.find((d) => d.id === v.documentId)?.title}
              </h3>
              {v.segments
                .filter((seg) => !seg.excluded)
                .map((seg) => (
                  <label className={s.checkRow} key={seg.id}>
                    <input
                      type="checkbox"
                      checked={draft.refs.some((r) => r.segmentId === seg.id)}
                      disabled={
                        !draft.refs.some((r) => r.segmentId === seg.id) &&
                        draft.refs.length >= 8
                      }
                      onChange={(e) =>
                        toggle(
                          {
                            segmentId: seg.id,
                            documentVersionId: v.id,
                            start: seg.start,
                            end: seg.end,
                            quote: seg.text,
                          },
                          e.target.checked,
                        )
                      }
                    />
                    <span>{seg.text}</span>
                  </label>
                ))}
            </div>
          ))}
        </fieldset>
        <div className={s.actions}>
          <button type="button" onClick={close}>
            返回
          </button>
          <button className={s.primary} disabled={!draft.refs.length}>
            套用到核對草稿
          </button>
        </div>
      </form>
    </Dialog>
  );
}
