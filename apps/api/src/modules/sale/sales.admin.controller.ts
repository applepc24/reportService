import { Controller, Post, Query } from '@nestjs/common';
import { SalesService } from './sales.service';
import { ConfigService } from '@nestjs/config';

@Controller('admin/sales')
export class SalesAdminController {
  constructor(
    private readonly salesService: SalesService,
    private readonly config: ConfigService,
  ) {}

  @Post('import')
  async import(@Query('period') period: string, @Query('apiKey') apiKey?: string) {
    const key = apiKey || this.config.get<string>('SEOUL_API_KEY');
    if (!key) return { ok: false, error: 'missing apiKey' };
    const inserted = await this.salesService.importQuarter(key, period);
    return { ok: true, inserted, period };
  }
}