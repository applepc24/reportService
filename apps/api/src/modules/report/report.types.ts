export interface ReportSummary {
    count: number;
    avgRating: number;
    reviews: number;
  }

export interface ReportTopPub {
    name: string;
    rating: number;
    reviewCount: number;
    }

export interface ReportMonthlyStat {
    month: string;   // '2025-06-01'처럼 YYYY-MM-DD 문자열
    reviews: number;
  }
export interface ReportResponse {
    dong: string;
    summary: ReportSummary;
    topPubs: ReportTopPub[];
    monthly: ReportMonthlyStat[];
  }