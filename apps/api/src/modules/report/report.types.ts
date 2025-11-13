

export interface ReportSummary {
  pubCount: number;
  avgRating: number | null;
  reviews: number;
}

export interface ReportTopPub {
  name: string;
  rating: number | null;
  reviewCount: number;
}

export interface ReportMonthlyStat {
  month: string; // '2025-06-01'처럼 YYYY-MM-DD 문자열
  reviews: number;
}

export interface ReportDong {
  id: number;
  name: string;
  code?: string | null;
}

export interface TrafficSummary {
  period: string;
  totalFootfall: number;
  maleRatio: number;
  femaleRatio: number;
  age20_30Ratio: number;
  peakTimeSlot: string;
}

export interface StoreSummary {
  dongCode: string;
  totalStoreCount: number;
  openStoreCount: number;
  closeStoreCount: number;
  franchiseStoreCount: number;
  openRate: number;
  closeRate: number;
  franchiseRatio: number;
}

export interface KakaoPub {
  name: string;
  category: string;
  url: string;
}

export interface TAChangeSummary {
  period: string;
  index: 'LL' | 'LH' | 'HL' | 'HH' | null;// TRDAR_CHNGE_IX
  indexName: string | null;   // TRDAR_CHNGE_IX_NM (예: 성장/쇠퇴/…)
  opRunMonthAvg?: number | null;
  clRunMonthAvg?: number | null;
  seoulOpRunMonthAvg?: number | null;
  seoulClRunMonthAvg?: number | null;
}

export interface SalesSection {
  period: string;
  totalAmt: number;
  weekendRatio: number;   // 0~1
  peakTimeSlot: string;   // '17-21'
}

export type FacilitySummary = {
  period: string;
  viatrFacilityCount: number;
  universityCount: number;
  subwayStationCount: number;
  busStopCount: number;
  bankCount: number;
};

export interface ReportResponse {
  dong: ReportDong;
  summary: ReportSummary;
  topPubs: ReportTopPub[];
  monthly: ReportMonthlyStat[];
  traffic?: TrafficSummary | null;
  store?: StoreSummary | null;
  kakaoPubs?: KakaoPub[];
  taChange?: TAChangeSummary | null;
  sales?: SalesSection | null;
  facility?: FacilitySummary | null;
}

export interface AdviceOptions {
  budgetLevel: string;
  concept: string;
  targetAge: string;
  openHours?: string;
}

export interface AdviceRequest {
  dongId: number;
  budgetLevel: string;
  concept: string;
  targetAge: string;
  openHours: string;
  question: string;
}

export interface AdviceResponse {
  report: ReportResponse;
  advice: string;
  places: AdvicePlace[];
}

export interface AdvicePlace {
  name: string;
  category: string;
  url: string;
}