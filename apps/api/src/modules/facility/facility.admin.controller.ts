import { Controller, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FacilityService } from './facility.service';

@Controller('admin/facility')
export class FacilityAdminController {
  constructor(
    private readonly service: FacilityService,
    private readonly config: ConfigService,
  ) {}

  @Post('import')
  async import(@Query('period') period: string, @Query('apiKey') apiKey?: string) {
    const key = apiKey ?? this.config.get<string>('SEOUL_API_KEY');
    if (!key) return { ok: false, error: 'missing apiKey' };

    const inserted = await this.service.importQuarter(key, period);
    return { ok: true, inserted, period };
  }
}