export type QuestionRoute = "DB" | "RAG";

const dbKeywords = ["월세", "임대료", "폐업률", "유동 인구", "매출", "점포 수"];
const ragKeywords = ["트렌드", "분위기", "데이트", "감성", "핫플", "요즘"];

export function classifyQuestion(question: string): QuestionRoute {
  const q = question ?? "";
  // RAG 키워드가 하나라도 포함되면 RAG 우선
  if (ragKeywords.some((k) => q.includes(k))) return "RAG";
  // 나머지는 일단 DB 쪽으로
  return "DB";
}