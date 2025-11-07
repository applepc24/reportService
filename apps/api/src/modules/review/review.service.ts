// src/modules/review/review.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Review } from './entities/review.entity';

@Injectable()
export class ReviewService {
  constructor(
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
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

  // (조금 더 나중에) dongId 기준 요약은 poi_pub join해서 만들 수 있음
}