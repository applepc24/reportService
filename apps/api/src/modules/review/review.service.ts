// src/modules/review/review.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Review } from './entities/review.entity';
import { ReportMonthlyStat } from '../report/report.types';

@Injectable()
export class ReviewService {
  constructor(
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,

    private readonly dataSource: DataSource,
  ) {}

  // 특정 술집(poi)에 대한 리뷰들
  findByPoi(poiId: number): Promise<Review[]> {
    return this.reviewRepo.find({
      where: { poiId },
      order: { date: 'DESC' },
      take: 50,
    });
  }

  // (간단 버전) 특정 술집의 평균 평점 + 리뷰 개수
  async getSummaryByPoi(poiId: number) {
    const { avg, count } = await this.reviewRepo
      .createQueryBuilder('r')
      .select('AVG(r.rating)', 'avg')
      .addSelect('COUNT(*)', 'count')
      .where('r.poi_id = :poiId', { poiId })
      .getRawOne();

    return {
      poiId,
      avgRating: avg ? Number(avg) : null,
      reviewCount: Number(count ?? 0),
    };
  }

  async getMonthlyStatsByDong(dongId: number): Promise<ReportMonthlyStat[]> {
    const rows = await this.reviewRepo
      .createQueryBuilder('r')
      .innerJoin('poi_pub', 'p', 'p.id = r.poi_id')
      .select("date_trunc('month', r.date)", 'month')
      .addSelect('COUNT(*)', 'reviews')
      .where('p.dong_id = :dongId', { dongId })
      .andWhere("r.date >= (CURRENT_DATE - INTERVAL '12 months')")
      .groupBy("date_trunc('month', r.date)")
      .orderBy("date_trunc('month', r.date)", 'ASC')
      .getRawMany();

    // rows: [{ month: Date | string, reviews: string | number }, ...]
    return rows.map((row) => {
      const monthValue = row.month as Date | string;

      // Postgres 드라이버 설정에 따라 Date거나 string일 수 있어서 안전하게 처리
      const iso =
        monthValue instanceof Date
          ? monthValue.toISOString()
          : new Date(monthValue).toISOString();

      return {
        month: iso.slice(0, 10), // 'YYYY-MM-DD'
        reviews: Number(row.reviews),
      };
    });
  }

  // (조금 더 나중에) dongId 기준 요약은 poi_pub join해서 만들 수 있음
}