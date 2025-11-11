import { Controller, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TrafficService } from './traffic.service';

@Controller('traffic')
export class TrafficController {
  constructor(
    private readonly trafficService: TrafficService,
    private readonly configService: ConfigService,
  ) {}

  // 예: POST /traffic/import?yyyq=20251
  @Post('import')
  async importQuarter(
    @Query('yyyq') yyyq = '20251', // 기본값: 2025년 1분기
  ): Promise<{ period: string; inserted: number }> {
    const apiKey = this.configService.get<string>('SEOUL_API_KEY');
    if (!apiKey) {
      throw new Error('SEOUL_API_KEY is not set in .env');
    }

    const inserted = await this.trafficService.importQuarter(apiKey, yyyq);
    return { period: yyyq, inserted };
  }
}