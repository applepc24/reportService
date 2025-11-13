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
import { KakaoLocalService } from "../kakao/kakao-local.service";
import { ReportResponse, AdviceResponse, AdviceRequest } from "./report.types";
import { AdviceDto } from "./dto/advice.dto";

@Controller("report")
export class ReportController {
  constructor(
    private readonly reportService: ReportService,
    private readonly kakaoLocalService: KakaoLocalService
  ) {}

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
      report,
      {
        budgetLevel: body.budgetLevel,
        concept: body.concept,
        targetAge: body.targetAge,
        openHours: body.openHours,
      },
      body.question
    );
    const keyword =
    body.concept && body.concept.trim().length > 0
      ? body.concept
      : '술집';

  const placesRaw = await this.kakaoLocalService.searchByDongAndKeyword(
    report.dong.name, // 예: "연남동"
    keyword,          // 예: "칵테일 바" or "술집"
    5,                // 5개 정도만
  );

  const places = placesRaw.map((p) => ({
    name: p.placeName,
    category: p.categoryName,
    url: p.placeUrl,
  }));

    return { report, advice, places };
  }
}
