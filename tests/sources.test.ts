import { describe, it, expect } from "vitest";
import {
  resolveRefs,
  segmentText,
  validateResolvedRefs,
  sensitiveCondition,
} from "../src/domain/sources";
import {
  matchGuard,
  rewriteIssues,
  unsupportedText,
  validateItemFacts,
} from "../src/domain/guardrails";
import { sseFrames } from "../src/domain/sse";
import { estimatedCost } from "../src/server/model/provider";
import type { Version, Item, MatchItem } from "../src/domain/types";
const version = (text: string): Version => ({
  id: "v",
  documentId: "d",
  text,
  original: text,
  hash: "h",
  segments: segmentText(text, "v"),
  createdAt: "2026-10-07",
});
const fact = (text: string, years: number | null = null): Item => {
  const v = version(text);
  return {
    id: "f",
    label: text,
    kind: "skill",
    category: null,
    platform: "unknown",
    years,
    refs: resolveRefs([{ segmentId: v.segments[0].id, quote: text }], [v]),
    origin: "model",
    edited: false,
  };
};
const match: MatchItem = {
  requirementId: "r",
  status: "supported",
  reason: "符合",
  evidenceRefs: [],
  clarifyingQuestion: null,
  suggestedAction: null,
  excluded: false,
  guardrail: null,
};
describe("來源與事實邊界", () => {
  it("以 UTF-16 精確定位中文、表情符號及組合字元", () => {
    const v = version("標題\n- React Web 👩‍💻 é 中文");
    const refs = resolveRefs(
      [{ segmentId: v.segments[1].id, quote: "👩‍💻 é" }],
      [v],
    );
    expect(v.text.slice(refs[0].start, refs[0].end)).toBe("👩‍💻 é");
    validateResolvedRefs(refs, [v]);
    expect(() =>
      validateResolvedRefs([{ ...refs[0], start: 0 }], [v]),
    ).toThrow();
  });
  it("拒絕不存在、重复及已排除引用", () => {
    const v = version("React React");
    expect(() =>
      resolveRefs([{ segmentId: v.segments[0].id, quote: "React" }], [v]),
    ).toThrow();
    expect(() =>
      resolveRefs([{ segmentId: "other", quote: "React" }], [v]),
    ).toThrow();
    v.segments[0].excluded = true;
    expect(() =>
      resolveRefs([{ segmentId: v.segments[0].id, quote: v.text }], [v]),
    ).toThrow();
  });
  it("文件版本變更使舊位置失效", () => {
    const v = version("中文");
    const r = resolveRefs([{ segmentId: "v-s1", quote: "中文" }], [v]);
    expect(() => validateResolvedRefs(r, [{ ...v, id: "v2" }])).toThrow();
  });
  it("長文字不切開英文單字，忽略空行", () => {
    const v = version("\n" + "TypeScript".repeat(200));
    expect(v.segments).toHaveLength(1);
    expect(v.segments[0].text).toBe(v.text.trim());
  });
  it("阻擋新增數字、技術與責任升級", () => {
    expect(
      unsupportedText("主導 Next.js，降低 30%", "參與 React Web").length,
    ).toBeGreaterThan(2);
    const f = fact("2014–2024 iOS 工程師");
    expect(() => validateItemFacts({ ...f, years: 10 })).toThrow();
    const unrelated = fact("十年 iOS；使用 React Web");
    expect(() =>
      validateItemFacts({ ...unrelated, label: "React Web", years: 10 }),
    ).toThrow();
  });
  it("React Native 不等於 React Web，也不等於 Next.js", () => {
    const f = fact("React Native 開發");
    const req = { ...fact("React Web 必要"), kind: "requirement" as const };
    expect(
      matchGuard(req, { ...match, evidenceRefs: f.refs }, [f], false).status,
    ).toBe("needs_confirmation");
    expect(
      matchGuard(
        { ...req, label: "Next.js" },
        { ...match, evidenceRefs: f.refs },
        [f],
        false,
      ).status,
    ).toBe("needs_confirmation");
    const denied = fact("使用 React Native，但沒有使用 React Web");
    expect(
      matchGuard(req, { ...match, evidenceRefs: denied.refs }, [denied], false).status,
    ).toBe("needs_confirmation");
    const mixed = fact("使用 React Web 開發網頁，沒有 React Native 經驗");
    expect(
      matchGuard(req, { ...match, evidenceRefs: mixed.refs }, [mixed], false).status,
    ).toBe("supported");
  });
  it("未明示技能年資與矛盾必須確認", () => {
    const f = fact("React Web 開發");
    expect(
      matchGuard(
        { ...f, years: 5 },
        { ...match, evidenceRefs: f.refs },
        [f],
        false,
      ).status,
    ).toBe("needs_confirmation");
    expect(matchGuard(f, match, [f], true).status).toBe("needs_confirmation");
  });
  it("同段 iOS 年資不可借給 React Web", () => {
    const ios = {
      ...fact("十年 iOS；使用 React Web", 10),
      label: "iOS 開發",
      platform: "mobile" as const,
    };
    validateItemFacts(ios);
    const req = {
      ...fact("React Web 明示 5 年經驗", 5),
      kind: "requirement" as const,
    };
    expect(
      matchGuard(req, { ...match, evidenceRefs: ios.refs }, [ios], false)
        .status,
    ).toBe("needs_confirmation");
  });
  it("JS 與 JavaScript 雙向對應仍保留原文", () => {
    const js = fact("使用 JS 開發網頁");
    const req = {
      ...fact("JavaScript 開發經驗"),
      kind: "requirement" as const,
    };
    expect(
      matchGuard(req, { ...match, evidenceRefs: js.refs }, [js], false).status,
    ).toBe("supported");
    expect(js.refs[0].quote).toBe("使用 JS 開發網頁");
  });
  it("行動端 TypeScript 不補成網頁端 TypeScript 實作", () => {
    const web = fact("使用 React Web 開發瀏覽器表單");
    const mobile = fact("使用 React Native 與 TypeScript 開發 iOS App");
    expect(
      matchGuard(
        { ...web, label: "React Web 與 TypeScript 網頁開發" },
        { ...match, evidenceRefs: [...web.refs, ...mobile.refs] },
        [web, mobile],
        false,
      ).status,
    ).toBe("needs_confirmation");
  });
  it("非職能條件排除，未提及不等於無能力", () => {
    const f = fact("年齡 30 歲以下");
    expect(sensitiveCondition(f.label)).toBe(true);
    expect(matchGuard(f, match, [], false).excluded).toBe(true);
    const excluded = matchGuard(f, {...match,clarifyingQuestion:"請補充年齡",suggestedAction:"補充生日"},[],false);
    expect(excluded.clarifyingQuestion).toBeNull();
    expect(excluded.suggestedAction).toBeNull();
    expect(
      matchGuard(
        { ...f, label: "Python" },
        {
          ...match,
          status: "missing_evidence",
          reason: "使用者沒有 Python 能力。",
        },
        [],
        false,
      ).reason,
    ).toContain("不能據此判斷不具備");
  });
  it("改寫每句覆蓋且不得新增成果", () => {
    const v = version("參與 React Web API 整合");
    const refs = resolveRefs([{ segmentId: "v-s1", quote: v.text }], [v]);
    expect(rewriteIssues(v.text, [{ text: v.text, refs }], [v])).toEqual([]);
    expect(
      rewriteIssues(v.text + "。主導提升 50%。", [{ text: v.text, refs }], [v])
        .length,
    ).toBeGreaterThan(0);
  });
});
describe("串流與費用", () => {
  it("解析跨分塊 UTF-8、多行及心跳", async () => {
    const bytes = new TextEncoder().encode(
      ': 心跳\r\n\r\ndata: {"中文":\r\ndata: "正常"}\r\n\r\n',
    );
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 3)
          c.enqueue(bytes.slice(i, i + 3));
        c.close();
      },
    });
    const frames = [];
    for await (const f of sseFrames(stream)) frames.push(JSON.parse(f));
    expect(frames).toEqual([{ 中文: "正常" }]);
  });
  it("截斷串流拒絕，未知用量不計成零", async () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("data: {}"));
        c.close();
      },
    });
    await expect(async () => {
      for await (const frame of sseFrames(stream)) void frame;
    }).rejects.toThrow();
    expect(
      estimatedCost(null, 0, 1, { input: 1, cached: 0.2, output: 2 }),
    ).toBeNull();
    expect(
      estimatedCost(1000, 200, 300, { input: 1, cached: 0.2, output: 2 }),
    ).toBeCloseTo(0.00144);
  });
});
