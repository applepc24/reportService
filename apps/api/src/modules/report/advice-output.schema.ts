import { z } from "zod";

/**
 * 1) LLM 출력(조언)을 항상 이 형태로 받겠다는 "계약(Contract)"
 * - markdown: 실제 화면에 보여줄 마크다운 본문(1~7 섹션 포함)
 * - citations: 근거(최소 1개 이상을 목표)
 */
export const CitationSchema = z.object({
  source: z.string().min(1),          // 예: "naver_blog", "kakao", "internal_db"
  url: z.string().url().optional(),   // 있으면 URL
  quote: z.string().min(1).optional() // 있으면 근거 문장
});

export const AdviceOutputSchema = z.object({
  version: z.literal("v1"),
  title: z.string().min(1),
  markdown: z.string().min(1),
  citations: z.array(CitationSchema).default([]),
  warnings: z.array(z.string()).default([]),
});

export type AdviceOutput = z.infer<typeof AdviceOutputSchema>;

// 일본어(히라가나/가타카나) 섞임 감지 — “あり” 같은 것 잡으려고
const containsJapaneseKana = (s: string) => /[\u3040-\u30ff]/.test(s);

// (선택) 가끔 줄 그어짐(~~) 문제 방지용 감지: 필요하면 나중에 강화 가능
const containsStrikethrough = (s: string) => /~~/.test(s);

export function validateAdviceOutput(raw: unknown):
  | { ok: true; value: AdviceOutput }
  | { ok: false; reason: string; detail?: any } {

  const parsed = AdviceOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "schema_invalid", detail: parsed.error.flatten() };
  }

  const v = parsed.data;

  if (containsJapaneseKana(v.markdown)) {
    return { ok: false, reason: "contains_japanese_kana" };
  }

  // 근거가 하나도 없으면 “깨진 출력”으로 보고 repair/fallback 대상으로 삼기 위함
  if (v.citations.length === 0) {
    return { ok: false, reason: "missing_citations" };
  }

  if (containsStrikethrough(v.markdown)) {
    return { ok: false, reason: "contains_strikethrough" };
  }

  return { ok: true, value: v };
}