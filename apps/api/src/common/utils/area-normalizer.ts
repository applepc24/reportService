export const MANUAL_AREA_MAP: Record<string, string> = {
    // 성수 특수 케이스
    '성수1가1동': '성수동',
    '성수1가2동': '성수동',
    '성수2가1동': '성수동',
    '성수2가3동': '성수동',
  
    // 홍대 상권
    '서교동': '홍대입구',
    '동교동': '홍대입구',
    '합정동': '홍대입구',
  };
  
  export const KNOWN_TREND_AREAS: string[] = Array.from(
    new Set(Object.values(MANUAL_AREA_MAP)),
  );
  /**
   * 행정동 이름(예: '성수1가1동', '남가좌1동')을
   * 트렌드 검색용 상권 키워드로 변환.
   */
  export function normalizeTrendArea(adminDong: string): string {
    const trimmed = (adminDong ?? '').trim();
    if (!trimmed) return '';
  
    // 1) 수동 맵 우선 (핫플/브랜드 상권들)
    if (MANUAL_AREA_MAP[trimmed]) {
      return MANUAL_AREA_MAP[trimmed];
    }
  
    // 2) 숫자 동 통합: '남가좌1동' → '남가좌동'
    //    '연남1동' 같은 패턴도 여기서 처리 가능
    const m = trimmed.match(/^(.*?)([0-9]+)동$/);
    if (m) {
      return `${m[1]}동`;
    }
  
    // 3) 그 외는 그냥 그대로 사용
    return trimmed;
  }