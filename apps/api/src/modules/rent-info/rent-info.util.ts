// apps/api/src/modules/rent-info/rent-info.util.ts

/**
 * "서울특별시 용산구 한강로2가" 같이 붙어있는 시군구 컬럼에서
 * sido, sigungu, emdNameRaw, emdNameBase를 뽑아준다.
 */
export function parseSigungucolumn(
    sigunguField: string
  ): {
    sido: string;
    sigungu: string;
    emdNameRaw: string | null;
    emdNameBase: string | null;
  } {
    if (!sigunguField) {
      return {
        sido: "",
        sigungu: "",
        emdNameRaw: null,
        emdNameBase: null,
      };
    }
  
    const tokens = sigunguField.trim().split(/\s+/);
    const sido = tokens[0] ?? "";
    const sigungu = tokens[1] ?? "";
    // 나머지를 다 합쳐서 "동/가" 부분으로 본다 (예: "한강로2가", "영등포동3가", "신정동")
    const emdRaw = tokens.length > 2 ? tokens.slice(2).join(" ") : "";
  
    return {
      sido,
      sigungu,
      emdNameRaw: emdRaw || null,
      emdNameBase: emdRaw ? normalizeEmdBase(emdRaw) : null,
    };
  }
  
  /**
   * 동 이름 정규화:
   * - "영등포동3가" → "영등포동"
   * - "한강로2가"   → "한강로"
   * - 그 외에는 일단 그대로 둔다.
   *
   * 100% 매핑이 아니라 "대략 이 동네 상권" 정도로 쓰는 용도라
   * 너무 공격적으로 자르기보단 보수적으로 간다.
   */
  export function normalizeEmdBase(emdRaw: string): string {
    const s = (emdRaw || "").trim();
    if (!s) return "";
  
    // 1) "영등포동3가" → "영등포동"
    const mDong = s.match(/^(.+동)\d+가$/);
    if (mDong) {
      return mDong[1];
    }
  
    // 2) "한강로2가" → "한강로"
    const mRo = s.match(/^(.+로)\d+가$/);
    if (mRo) {
      return mRo[1];
    }
  
    // 3) 그 외는 일단 그대로 사용
    return s;
  }