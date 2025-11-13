// src/modules/admin-batch/admin-batch.controller.ts
import { Controller, Post, Query } from '@nestjs/common';
import { SalesService } from '../sale/sales.service';
import { TAChangeService } from '../ta_change/ta-change.service';
import { FacilityService } from '../facility/facility.service';

@Controller('admin/batch')
export class AdminBatchController {
  constructor(
    private readonly salesService: SalesService,
    private readonly taChangeService: TAChangeService,
    private readonly facilityService: FacilityService,
  ) {}

  @Post('import-quarter')
  async importQuarter(@Query('period') period: string) {
    const apiKey = process.env.SEOUL_API_KEY!;
    // 1) 원천 데이터 세 개 순서대로
    await this.salesService.importQuarter(apiKey, period);
    await this.taChangeService.importQuarter(apiKey, period);
    await this.facilityService.importQuarter(apiKey, period);

    // 2) 머터리얼라이즈드 뷰 갱신
    await this.salesService.refreshDongQuarterView();

    return { ok: true, period };
  }
}