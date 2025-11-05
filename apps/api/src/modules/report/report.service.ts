import { Injectable } from '@nestjs/common';
import { ReportResponse } from './report.types';

@Injectable()
export class ReportService {
  getReport(dong: string): ReportResponse {
    return {
      dong,
      summary: { count: 32, avgRating: 4.3, reviews: 10592 },
      topPubs: [
        { name: '연남이자카야', rating: 4.6, reviewCount: 520 },
        { name: '하이볼연구소', rating: 4.4, reviewCount: 310 },
        { name: '○○포차', rating: 4.2, reviewCount: 190 },
      ],
      monthly: [
        { month: '2025-06-01', reviews: 120 },
        { month: '2025-07-01', reviews: 180 },
        { month: '2025-08-01', reviews: 210 },
      ],
    };
  }
}