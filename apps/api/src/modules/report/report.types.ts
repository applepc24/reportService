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
    month: string;   // '2025-06-01'처럼 YYYY-MM-DD 문자열
    reviews: number;
  }

export interface ReportDong {
  id: number;
  name: string;
  code?: string | null;
}

export interface ReportResponse {
    dong: ReportDong;
    summary: ReportSummary;
    topPubs: ReportTopPub[];
    monthly: ReportMonthlyStat[];
  }