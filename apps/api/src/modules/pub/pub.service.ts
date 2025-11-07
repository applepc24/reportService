// src/modules/pub/pub.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PoiPub } from './entities/pub.entity';

@Injectable()
export class PubService {
  constructor(
    @InjectRepository(PoiPub)
    private readonly pubRepo: Repository<PoiPub>,
  ) {}

  // 특정 동의 상위 N개 술집
  async getTopPubsByDong(dongId: number, limit = 5): Promise<PoiPub[]> {
    return this.pubRepo.find({
      where: { dongId },
      order: {
        rating: 'DESC',        // 별점 높은 순
        reviewCount: 'DESC',   // 리뷰 많은 순으로 2차 정렬
      },
      take: limit,
    });
  }
}