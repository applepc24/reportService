// src/modules/report/report.controller.ts
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  ParseIntPipe,
} from "@nestjs/common";
import { ReportService } from "./report.service";
import { ReportResponse, AdviceResponse, AdviceRequest } from "./report.types";
import { AdviceDto } from "./dto/advice.dto";

@Controller("report")
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Get()
  async getReport(
    @Query("dongId", ParseIntPipe) dongId: number
  ): Promise<ReportResponse> {
    return this.reportService.buildReport(dongId);
  }

  @Get("text")
  async getReportWithText(
    @Query("dongId", ParseIntPipe) dongId: number
  ): Promise<{ data: ReportResponse; text: string }> {
    const data = await this.reportService.buildReport(dongId);
    const text = await this.reportService.generateReportText(data);
    return { data, text };
  }

  @Post("advice")
  async getAdvice(@Body() body: AdviceRequest): Promise<AdviceResponse> {
    const report = await this.reportService.buildReport(body.dongId);

    const advice = await this.reportService.generateAdvice(
      body.dongId,
      {
        budgetLevel: body.budgetLevel,
        concept: body.concept,
        targetAge: body.targetAge,
        openHours: body.openHours,
      },
      body.question
    );

    return { report, advice };
  }
}
