import { Controller, Get, Query } from '@nestjs/common';
import { ReportService } from './report.service';
import { ReportResponse } from './report.types';

@Controller('report')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Get()
  getReport(@Query('dong') dong = '연남동'): ReportResponse {
    return this.reportService.getReport(dong);
  }
}