// src/modules/report/report.controller.ts
import { Controller, Get, Query, ParseIntPipe } from '@nestjs/common';
import { ReportService } from './report.service';
import { ReportResponse } from './report.types';

@Controller('report')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Get('text')
  async getReportWithText(
    @Query('dongId', ParseIntPipe) dongId: number,
  ): Promise<{ data: ReportResponse; text: string }> {
    const data = await this.reportService.buildReport(dongId);
    const text = await this.reportService.generateReportText(data);
    return { data, text };
}
}