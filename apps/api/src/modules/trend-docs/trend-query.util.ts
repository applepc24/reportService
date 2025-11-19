// src/modules/trend-docs/trend-query.util.ts
import OpenAI from "openai";
import { Logger } from "@nestjs/common";

// 한국어 질문에서 자주 쓰일 키워드 후보들
const TREND_KEYWORDS = [
  "와인바",
  "와인",
  "맥주",
  "칵테일",
  "소주",
  "칵테일바",
  "고급",
  "프리미엄",
  "가성비",
  "조용한",
  "시끄러운",
  "힙한",
  "감성",
  "데이트",
  "혼술",
  "직장인",
  "회사원",
  "인스타",
  "사진",
  "안주",
  "루프탑",
  "루프탑바",
  "바",
  "펍",
  "겨울",
  "야장",
  "유튜브",
];

// 불필요한 조사/어미 등 제거용 간단 스톱워드 (지금은 안 써도 일단 놔둠)
const STOPWORDS = [
  "싶어",
  "싶다",
  "싶은",
  "차리고",
  "차리고싶어",
  "차리고",
  "싶은데",
  "어떨까",
  "알려줘",
  "조언",
  "좀",
  "하고",
  "많이",
  "찾을",
  "수",
  "있는",
];

/**
 * ✅ 키워드 기반 fallback 버전
 * - LLM이 실패하거나, 굳이 LLM 쓸 필요 없을 때 사용
 */
export function buildNaverQueryFromQuestion(
  question: string,
  trendAreaKeyword?: string,
): string {
  const q = (question || "").toLowerCase();

  // 1) 키워드 후보 중 질문에 등장하는 것만 추출
  const matched = TREND_KEYWORDS.filter((kw) => q.includes(kw));

  // 3) area + 키워드를 자연스럽게 붙여서 쿼리 생성
  const areaPart = trendAreaKeyword || "";

  let keywordPart = "";
  if (matched.length > 0) {
    // 최대 2~3개 정도만
    keywordPart = matched.slice(0, 3).join(" ");
  } else {
    // 아무것도 못 뽑으면 기본 "술집"으로 대체
    keywordPart = "술집";
  }

  let query = [areaPart, keywordPart].filter(Boolean).join(" ").trim();

  // 완전 비면 fallback
  if (!query) query = "서울 술집";

  // 동네가 있으면 "서울 {동네} ..." 형태로 한번 더 보정
  if (trendAreaKeyword && !query.includes(trendAreaKeyword)) {
    query = `서울 ${trendAreaKeyword} ${query}`;
  }

  return query;
}

/**
 * ✅ LLM 기반 버전
 * - OpenAI 인스턴스 & 모델명을 외부에서 주입받음
 * - 실패하면 null 반환 → 호출 측에서 fallback 사용
 */
export async function buildNaverQueryWithLLM(
  openai: OpenAI,
  modelName: string,
  question: string,
  trendAreaKeyword?: string,
  logger?: Logger,
): Promise<string | null> {
  try {
    const systemPrompt = `
너는 네이버 블로그 검색용 "짧은 키워드 쿼리"를 만들어주는 도우미야.

조건:
- 출력은 반드시 네이버 검색창에 바로 넣을 수 있는 한 줄짜리 쿼리만 내보낸다.
- 설명, 말투, 따옴표, 마크다운 전혀 쓰지 말고, 검색어만 출력해라.
- 사용자가 말한 동네와 컨셉, 트렌드 관련 단어를 잘 뽑아서 결합해라.
- 가능하면 3~6단어 정도 길이로 짧게 만들고, 불필요한 조사/어미는 빼라.
- 이미 상권 키워드(예: 홍제동, 연남동)가 주어지면, 그 동네 중심으로 검색되게 해라.
- 이 서비스는 "서울 상권" 위주이므로, 상권 키워드가 있으면 최대한 "서울 {동네} ..." 형태로 만들어라.
- 예시:
  - 질문: "요즘 트렌드에 맞는 조용한 와인바를 내고 싶어"
    - 상권: 연남동 → "서울 연남동 조용한 와인바"
  - 질문: "인스타에 사진 잘 나오는 안주 파는 힙한 술집"
    - 상권: 성수동 → "서울 성수동 인스타 안주 힙한 술집"
`.trim();

    const userContent = `
[상권 키워드]
${trendAreaKeyword || "(없음)"}

[사용자 질문]
${question}
`.trim();

    const completion = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      max_tokens: 50,
    });

    let text = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!text) return null;

    // 혹시 모델이 줄바꿈 넣어버리면 첫 줄만 사용
    text = text.split("\n")[0].trim();
    // 혹시 따옴표 감싸면 제거
    text = text.replace(/^["']|["']$/g, "").trim();

    // 방어적으로 "서울" / 상권 키워드 보정 한 번 더
    if (trendAreaKeyword) {
      if (!text.includes(trendAreaKeyword)) {
        text = `${trendAreaKeyword} ${text}`.trim();
      }
      if (!text.includes("서울")) {
        text = `서울 ${text}`.trim();
      }
    }

    return text;
  } catch (e) {
    logger?.warn?.(`buildNaverQueryWithLLM 실패: ${e}`);
    return null;
  }
}