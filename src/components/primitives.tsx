"use client";
import { useEffect, useRef, type ReactNode } from "react";
import type { Ref } from "@/domain/types";
import { useApp } from "./AppContext";
import s from "./workbench.module.css";
export function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={s.dialog}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-labelledby="dialog-title"
    >
      <header className={s.row}>
        <h2 id="dialog-title">{title}</h2>
        <button aria-label="關閉面板" onClick={close}>
          關閉
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Citation({
  reference,
  index = 1,
}: {
  reference: Ref;
  index?: number;
}) {
  const { showSource } = useApp();
  return (
    <button
      className={s.citation}
      onClick={() => showSource(reference)}
      aria-label={`核對原文引用 ${index}：${reference.quote.slice(0, 60)}`}
    >
      原文 {index} ↗
    </button>
  );
}
export function References({ refs }: { refs: Ref[] }) {
  return (
    <div className={s.refs}>
      {refs.map((r, i) => (
        <Citation key={r.segmentId + r.start + i} reference={r} index={i + 1} />
      ))}
    </div>
  );
}
export function SourcePanel() {
  const { source, data, showSource } = useApp();
  if (!source || !data) return null;
  const version = data.versions.find((v) => v.id === source.documentVersionId);
  const document = data.documents.find((d) => d.id === version?.documentId);
  const segment = version?.segments.find((s) => s.id === source.segmentId);
  return (
    <Dialog title="核對使用者提供的原文" close={() => showSource(null)}>
      <p>
        {document?.title || "歷史來源"} · 第 {segment?.line} 行
      </p>
      <p className={s.muted}>
        原文版本 {version?.id.slice(0, 8)} · 引用依 UTF-16（字串位置）精確定位。
      </p>
      {version && segment ? (
        <div className={s.sourceText}>
          {version.text.slice(Math.max(0, segment.start - 180), source.start)}
          <mark>{version.text.slice(source.start, source.end)}</mark>
          {version.text.slice(
            source.end,
            Math.min(version.text.length, segment.end + 180),
          )}
        </div>
      ) : (
        <p role="alert">來源不存在，請重新核對；未猜測定位。</p>
      )}
      <details>
        <summary>查看完整不可變原文</summary>
        <pre className={s.sourceText}>{version?.text}</pre>
      </details>
    </Dialog>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={s.empty}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}
