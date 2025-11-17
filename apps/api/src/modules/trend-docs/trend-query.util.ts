// src/modules/trend-docs/trend-query.util.ts

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
    "유튜브"
  ];
  
  // 불필요한 조사/어미 등 제거용 간단 스톱워드
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
  
  export function buildNaverQueryFromQuestion(
    question: string,
    trendAreaKeyword?: string,
  ): string {
    const q = (question || "").toLowerCase();
  
    // 1) 키워드 후보 중 질문에 등장하는 것만 추출
    const matched = TREND_KEYWORDS.filter((kw) => q.includes(kw));
  
    // 2) stopword 제거는 지금은 생략하고, 진짜 포함된 키워드만 사용
  
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
  
    const query = [areaPart, keywordPart].filter(Boolean).join(" ");
  
    // 완전 비면 fallback
    return query || "서울 술집";
  }