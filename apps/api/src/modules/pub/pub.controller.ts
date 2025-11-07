// src/modules/pub/pub.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { PubService } from './pub.service';
import { PoiPub } from './entities/pub.entity';

@Controller('pub')
export class PubController {
  constructor(private readonly pubService: PubService) {}

  // GET /pub/top?dongId=1&limit=5
  @Get('top')
  async getTopPubs(
    @Query('dongId') dongIdStr: string,
    @Query('limit') limitStr?: string,
  ): Promise<PoiPub[]> {
    const dongId = Number(dongIdStr);
    const limit = limitStr ? Number(limitStr) : 5;

    if (Number.isNaN(dongId)) {
      // NestException 써도 되는데 지금은 그냥 빈 배열로 대충 처리
      return [];
    }

    return this.pubService.getTopPubsByDong(dongId, limit);
  }
}