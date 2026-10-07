import type { Ref, Segment, Version } from "./types";
import type { RawRef } from "./schemas";
import { requireCondition } from "./errors";

export function segmentText(text: string, prefix: string): Segment[] {
  const segments: Segment[] = [];
  let line = 1;
  // 每個非空行是穩定段落，長行在標點或空白處分段，位置仍以原文計算。
  const rows = text.matchAll(/[^\n]+/g);
  for (const row of rows) {
    const offset = row.index;
    line = text.slice(0, offset).split("\n").length;
    if (!row[0].trim()) continue;
    let start = offset;
    const end = offset + row[0].length;
    while (start < end) {
      let cut = Math.min(end, start + 1200);
      if (cut < end) {
        const chunk = text.slice(start, cut);
        const boundary = Math.max(
          chunk.lastIndexOf("。"),
          chunk.lastIndexOf("；"),
          chunk.lastIndexOf(" "),
        );
        if (boundary > 600) cut = start + boundary + 1;
        else {
          const next = text.slice(cut, end).search(/[。；\s]/);
          if (next >= 0) cut += next + 1;
          else cut = end;
        }
      }
      segments.push({
        id: `${prefix}-s${segments.length + 1}`,
        start,
        end: cut,
        line,
        text: text.slice(start, cut),
        excluded: false,
      });
      start = cut;
    }
  }
  return segments;
}
export function resolveRefs(raw: RawRef[], versions: Version[]): Ref[] {
  return raw.map((ref) => {
    const version = versions.find((v) =>
      v.segments.some((s) => s.id === ref.segmentId),
    );
    const segment = version?.segments.find((s) => s.id === ref.segmentId);
    requireCondition(
      version && segment && !segment.excluded,
      "SOURCE_INVALID",
      "引用不在本次允許分析的原文中。",
      422,
    );
    const index = segment.text.indexOf(ref.quote);
    requireCondition(
      index >= 0 && segment.text.indexOf(ref.quote, index + 1) < 0,
      "QUOTE_INVALID",
      "引句不存在或無法唯一定位，結果未採用。",
      422,
    );
    return {
      ...ref,
      documentVersionId: version.id,
      start: segment.start + index,
      end: segment.start + index + ref.quote.length,
    };
  });
}
export function validateResolvedRefs(refs: Ref[], versions: Version[]) {
  const resolved = resolveRefs(refs, versions);
  refs.forEach((ref, i) =>
    requireCondition(
      ref.documentVersionId === resolved[i].documentVersionId &&
        ref.start === resolved[i].start &&
        ref.end === resolved[i].end,
      "SOURCE_POSITION",
      "引用版本或位置不符合原文。",
      422,
    ),
  );
}
export function sensitiveCondition(text: string) {
  return /年齡|歲以下|歲以上|性別|男性|女性|婚姻|已婚|未婚|種族|宗教|出生日期/.test(
    text,
  );
}
