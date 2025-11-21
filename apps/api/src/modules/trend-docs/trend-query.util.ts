// src/modules/trend-docs/trend-query.util.ts
import OpenAI from "openai";
import { Logger } from "@nestjs/common";
import { isPerfFakeExternal, delay } from "../../common/utils/perf.util";

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

// ✅ 술집 도메인 토큰 (없으면 강제)
const DOMAIN_TOKENS = [
  "술집",
  "소주집",
  "맥주집",
  "와인바",
  "칵테일바",
  "바",
  "펍",
  "안주",
];

// 불필요한 조사/어미 등 제거용 간단 스톱워드 (지금은 안 씀)
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
 * ✅ 공통 후처리:
 * - 서울 강제
 * - area 있으면 힌트로만 붙이기
 * - 술집 도메인 토큰 없으면 "술집" 강제
 */
function normalizeQuery(raw: string, trendAreaKeyword?: string): string {
  let text = (raw || "").trim();

  // 1) 서울 무조건 포함
  if (!text.includes("서울")) {
    text = `서울 ${text}`.trim();
  }

  // 2) area는 "있으면 힌트로"만
  if (trendAreaKeyword && !text.includes(trendAreaKeyword)) {
    text = `서울 ${trendAreaKeyword} ${text.replace(/^서울\s*/, "")}`.trim();
  }

  // 3) 술집 도메인 토큰이 하나도 없으면 강제 추가
  const hasDomain = DOMAIN_TOKENS.some((t) => text.includes(t));
  if (!hasDomain) {
    text = `${text} 술집`.trim();
  }
  const domainHint = "(술집 OR 소주집 OR 주점 OR bar OR 이자카야)";
  if (!text.includes("OR")) {
    text = `${text} ${domainHint}`.trim();
  }

  return text;
}

/**
 * ✅ 키워드 기반 fallback 버전
 * - LLM이 실패하거나, 굳이 LLM 쓸 필요 없을 때 사용
 */
export function buildNaverQueryFromQuestion(
  question: string,
  trendAreaKeyword?: string
): string {
  const q = (question || "").toLowerCase();

  // 1) 키워드 후보 중 질문에 등장하는 것만 추출
  const matched = TREND_KEYWORDS.filter((kw) => q.includes(kw));

  let keywordPart = "";
  if (matched.length > 0) {
    keywordPart = matched.slice(0, 3).join(" ");
  } else {
    keywordPart = "술집";
  }

  // area는 여기서 강제하지 말고 normalizeQuery에서 힌트로만 처리
  const rawQuery = keywordPart.trim() || "술집";

  return normalizeQuery(rawQuery, trendAreaKeyword);
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
  logger?: Logger
): Promise<string | null> {
  if (isPerfFakeExternal()) {
    await delay(10); // LLM 레이턴시 흉내만
    return buildNaverQueryFromQuestion(question, trendAreaKeyword);
  }

  try {
    const systemPrompt = `
너는 네이버 블로그 검색용 "짧은 키워드 쿼리"를 만들어주는 도우미야.

조건:
- 출력은 반드시 네이버 검색창에 바로 넣을 수 있는 한 줄짜리 쿼리만 내보낸다.
- 설명, 말투, 따옴표, 마크다운 전혀 쓰지 말고 검색어만 출력해라.
- 3~6단어 정도로 짧게.
- (중요) 이 서비스는 "서울 술집 트렌드"용이다.
  - 서울을 항상 포함해라.
  - 업종(술집/바/소주/맥주/칵테일/와인/안주) 관련 단어를 최소 1개 포함해라.
  - 상권 키워드가 있으면 참고하되 없어도 동작해야 한다.
예시:
- "요즘 조용하고 힙한 술집" → "서울 조용한 힙한 술집"
- "모던한 칵테일바 트렌드" → "서울 모던 칵테일바"
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

    // ✅ 공통 후처리로 서울+area+도메인 보정
    return normalizeQuery(text, trendAreaKeyword);
  } catch (e) {
    logger?.warn?.(`buildNaverQueryWithLLM 실패: ${e}`);
    return null;
  }
}
