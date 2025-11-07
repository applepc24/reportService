// src/modules/review/review.controller.ts
import { Controller, Get, Param } from '@nestjs/common';
import { ReviewService } from './review.service';
import { Review } from './entities/review.entity';

@Controller('review')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  // GET /review/poi/1
  @Get('poi/:poiId')
  getByPoi(@Param('poiId') poiIdStr: string): Promise<Review[]> {
    const poiId = Number(poiIdStr);
    return this.reviewService.findByPoi(poiId);
  }

  // GET /review/poi/1/summary
  @Get('poi/:poiId/summary')
  getSummaryByPoi(@Param('poiId') poiIdStr: string) {
    const poiId = Number(poiIdStr);
    return this.reviewService.getSummaryByPoi(poiId);
  }
}