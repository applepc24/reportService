// src/modules/ta-change/ta-change.admin.controller.ts
import { Controller, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TAChangeService } from './ta-change.service';

@Controller('admin/ta-change')
export class TAChangeAdminController {
  constructor(
    private readonly svc: TAChangeService,
    private readonly config: ConfigService,
  ) {}

  @Post('import')
  async import(@Query('period') period: string, @Query('apiKey') apiKey?: string) {
    const key = apiKey ?? this.config.get<string>('SEOUL_API_KEY');
    if (!key) {
      return { ok: false, error: 'missing apiKey' };
    }
    const n = await this.svc.importQuarter(key, period);
    return { ok: true, inserted: n, period };
  }
}