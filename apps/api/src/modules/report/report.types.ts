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
  totalFootfall: number | null;
  age20sRatio: number | null;
  eveningRatio: number | null;
}

export interface ReportResponse {
  dong: ReportDong;
  summary: ReportSummary;
  topPubs: ReportTopPub[];
  monthly: ReportMonthlyStat[];
  traffic?: TrafficSummary | null;
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
  places: AdvicePlace[];  // 🔹 카카오에서 가져온 장소들
}

export interface AdvicePlace {
  name: string;
  category: string;
  url: string;
}