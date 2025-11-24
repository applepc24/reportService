// src/modules/report/slim-report.types.ts

export type SlimSalesTrendItem = {
    period: string;
    alcoholTotalAmt: number;
    alcoholWeekendRatio: number | null;
    qoqGrowth: number | null;
    changeIndex: "LL" | "LH" | "HL" | "HH" | null;
    peakTimeSlot: string | null;
  };
  
  export type SlimReport = {
    dong: {
      id: number;
      name: string;
      code: string | null;
    };
  
    summary: {
      pubCount: number;
    };
  
    traffic: {
      totalFootfall: number | null;
      maleRatio: number | null;
      femaleRatio: number | null;
      age20_30Ratio: number | null;
      peakTimeSlot: string | null;
    } | null;
  
    store: {
      totalStoreCount: number | null;
      openRate: number | null;
      closeRate: number | null;
      franchiseRatio: number | null;
    } | null;
  
    sales: {
      period: string;
      totalAmt: number | null;
      weekendRatio: number | null;
      peakTimeSlot: string | null;
    } | null;
  
    taChange: {
      period: string;
      index: "LL" | "LH" | "HL" | "HH" | null;
      indexName: string | null;
    } | null;
  
    facility: {
      viatrFacilityCount: number | null;
      universityCount: number | null;
      subwayStationCount: number | null;
      busStopCount: number | null;
      bankCount: number | null;
    } | null;
  
    // ✅ 과거 전체 말고 “최근 N개 + 추세용 핵심”
    salesTrend: {
      recent: SlimSalesTrendItem[];   // 최근 6~8개 분기
      longTermDirection: "up" | "down" | "flat" | "mixed" | null;
      recentNegativeStreak: number;
      recentQoqAvg: number | null;
      recentQoqVolatility: number | null;
    };
  
    // ✅ 가게 예시는 “이름/카테고리만 3~5개”
    kakaoPubs: { name: string; category: string }[];
  
    risk: {
      level: "low" | "medium" | "high";
      reasons: string[];
    } | null;
  };