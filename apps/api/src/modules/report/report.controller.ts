// src/modules/report/report.controller.ts
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  ParseIntPipe,
  Inject,
  Param,
} from "@nestjs/common";
import { ReportService } from "./report.service";
import { Queue } from "bullmq";
import { KakaoLocalService } from "../kakao/kakao-local.service";
import { ReportResponse, AdviceResponse, AdviceRequest } from "./report.types";
import { AdviceRequestDto } from "./dto/advicerequest.dto";

@Controller("report")
export class ReportController {
  constructor(
    private readonly reportService: ReportService,
    private readonly kakaoLocalService: KakaoLocalService,
    @Inject("ADVICE_QUEUE") private readonly adviceQueue: Queue
  ) {}

  @Post("advice")
  async requestAdvice(@Body() dto: AdviceRequestDto) {
    // 1) job payload 구성
    const payload = {
      dongId: dto.dongId,
      options: dto.options,
      question: dto.question ?? "",
    };

    // 2) 큐에 job 추가
    const job = await this.adviceQueue.add("generate-advice", payload);

    // 3) 바로 응답 (HTTP 1초 내 종료)
    return {
      ok: true,
      jobId: job.id,
      status: "queued",
    };
  }

  @Get("advice/:jobId")
  async getAdviceResult(@Param("jobId") jobId: string) {
    const job = await this.adviceQueue.getJob(jobId);
    if (!job) {
      return { ok: false, status: "not_found" };
    }

    const state = await job.getState(); // waiting | active | completed | failed ...
    const rv = job.returnvalue ?? null;

    if (state !== "completed") {
      return {
        ok: true,
        status: state,
        result: null,
        failedReason: job.failedReason ?? null,
      };
    }

    const result = {
      report: {
        dong: rv?.dong ?? null,
      },
      advice: rv?.advice ?? "",
      places: rv?.places ?? [], // 없으면 빈 배열
    };

    return {
      ok: true,
      status: state,
      result,
      failedReason: job.failedReason ?? null,
    };
  }

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

  @Post("advice-sync")
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
      body.concept && body.concept.trim().length > 0 ? body.concept : "술집";

    const placesRaw = await this.kakaoLocalService.searchByDongAndKeyword(
      report.dong.name, // 예: "연남동"
      keyword, // 예: "칵테일 바" or "술집"
      5 // 5개 정도만
    );

    const places = placesRaw.map((p) => ({
      name: p.placeName,
      category: p.categoryName,
      url: p.placeUrl,
    }));

    return { report, advice, places };
  }
}
