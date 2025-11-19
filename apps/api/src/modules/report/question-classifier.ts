// src/modules/report/question-classifier.ts
import OpenAI from "openai";

export type QuestionRoute = "DB" | "RAG";

const dbKeywords = ["월세", "임대료", "폐업률", "유동 인구", "매출", "점포 수"];
const ragKeywords = [
  "트렌드",
  "분위기",
  "데이트",
  "감성",
  "핫플",
  "요즘",
  "힙한",
  "인스타",
  "사진",
  "안주",
  "컨셉",
  "감성술집",
];

// 👉 키워드 기반 간단 fallback
function classifyQuestionFallback(question: string): QuestionRoute {
  const q = question ?? "";
  if (ragKeywords.some((k) => q.includes(k))) return "RAG";
  if (dbKeywords.some((k) => q.includes(k))) return "DB";
  // 애매하면 그냥 DB
  return "DB";
}

/**
 * LLM 기반 질문 분류
 * - "트렌드/분위기/컨셉/감성" 쪽이면 RAG
 * - "데이터/매출/유동인구/폐업률" 쪽이면 DB
 */
export async function classifyQuestion(
  question: string,
): Promise<QuestionRoute> {
  const q = (question ?? "").trim();
  if (!q) return "DB";

  // 환경변수에서 키 가져오기
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // 키 없으면 그냥 키워드 fallback
    return classifyQuestionFallback(q);
  }

  const client = new OpenAI({ apiKey });

  const prompt = `
다음 사용자의 질문이 어떤 유형인지 판단해줘.

[유형 설명]
- "트렌드/분위기/컨셉" 중심 -> RAG
  (예: 힙한 분위기, 감성, 인스타, 사진, 요즘 스타일, 느낌적인 느낌, 신조어/밈 표현 등)
- "데이터/지표/숫자/시장분석" 중심 -> DB
  (예: 유동인구, 폐업률, 매출, 점포 수, 임대료, 통계, 지표 등)

[질문]
"${q}"

정답은 RAG 또는 DB 중 하나만 딱 한 단어로 출력해.
  `.trim();

  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 10,
    });

    const answer = (res.choices[0].message.content || "").trim();

    if (answer.includes("RAG")) return "RAG";
    if (answer.includes("DB")) return "DB";

    // 이상한 답 나오면 fallback
    return classifyQuestionFallback(q);
  } catch (e) {
    // LLM 에러나면 그냥 키워드 모드로
    return classifyQuestionFallback(q);
  }
}