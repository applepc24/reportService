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
  Sse,
  Res,
  Logger,
} from "@nestjs/common";
import { ReportService } from "./report.service";
import { Queue } from "bullmq";
import { KakaoLocalService } from "../kakao/kakao-local.service";
import { ReportResponse, AdviceResponse, AdviceRequest } from "./report.types";
import { AdviceRequestDto } from "./dto/advicerequest.dto";
import { interval, map, Observable, merge } from "rxjs";
import IORedis from "ioredis";

@Controller("report")
export class ReportController {
  private readonly logger = new Logger(ReportController.name);
  constructor(
    private readonly reportService: ReportService,
    private readonly kakaoLocalService: KakaoLocalService,
    @Inject("ADVICE_QUEUE") private readonly adviceQueue: Queue,
    @Inject("BULLMQ_REDIS") private readonly redis: IORedis
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

  @Get("advice/:jobId/stream")
  streamAdvice(@Param("jobId") jobId: string, @Res() res: any) {
    const channel = `advice:job:${jobId}`;
    this.logger.log(`[SSE] subscribe channel=${channel}`);

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // nginx buffering off
    res.flushHeaders?.();

    let id = 0;
    let cleaned = false;

    const send = (event: string, data: any) => {
      if (res.writableEnded) return;

      id += 1;
      const payload = typeof data === "string" ? data : JSON.stringify(data);

      res.write(`event: ${event}\n`);
      res.write(`id: ${id}\n`);
      for (const line of payload.split("\n")) {
        res.write(`data: ${line}\n`);
      }
      res.write("\n");
    };

    // 구독용 커넥션
    const subRedis = this.redis.duplicate();

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;

      clearInterval(hb);
      subRedis.removeListener("message", onMessage);
      subRedis.unsubscribe(channel).finally(() => subRedis.disconnect());
    };

    const onMessage = (ch: string, message: string) => {
      if (ch !== channel) return;

      try {
        const evt = JSON.parse(message);
        send(evt.type ?? "message", evt.data ?? evt);

        // done/error면 자동 종료
        if (evt.type === "done" || evt.type === "error") {
          cleanup();
          res.end();
        }
      } catch {
        send("message", message);
      }
    };

    // 15초 heartbeat
    const hb = setInterval(() => {
      if (res.writableEnded) return;
      send("ping", { t: Date.now(), jobId });
    }, 15000);

    subRedis.on("message", onMessage);

    subRedis
      .subscribe(channel)
      .then(async () => {
        // 1) 연결 확인용
        send("progress", { jobId, stage: "subscribed" });

        // 2) 스냅샷(복구) 로드: stage/seq/text/last
        const lastKey = `advice:job:${jobId}:last`;
        const textKey = `advice:job:${jobId}:text`;
        const seqKey = `advice:job:${jobId}:seq`;
        const stageKey = `advice:job:${jobId}:stage`;

        const [[, stage], [, seqStr], [, text], [, last]] = (await this.redis
          .multi()
          .get(stageKey)
          .get(seqKey)
          .get(textKey)
          .get(lastKey)
          .exec()) as any;

        // stage 복구 (있으면)
        if (stage) {
          send("progress", { jobId, stage });
        }

        // 누적 텍스트 스냅샷 (있으면)
        const lastSeq = Number(seqStr ?? 0);
        if (text && String(text).length > 0) {
          send("delta_snapshot", { jobId, seq: lastSeq, text: String(text) });
        }

        // ✅ last 이벤트는 "done/error"만 반영 (delta/progress는 snapshot과 중복될 수 있음)
        if (last) {
          try {
            const evt = JSON.parse(last);
            if (evt?.type === "done" || evt?.type === "error") {
              send(evt.type, evt.data ?? evt);
              cleanup();
              res.end();
            }
          } catch {
            // ignore
          }
        }
      })
      .catch((e) => {
        send("error", { message: "subscribe_failed", detail: String(e) });
        cleanup();
        res.end();
      });

    res.on("close", cleanup);
  }

  @Post("advice/:jobId/publish-test")
  async publishTest(
    @Param("jobId") jobId: string,
    @Body() body: { type?: string; data?: any }
  ) {
    const channel = `advice:job:${jobId}`;
    const payload = {
      type: body?.type ?? "message",
      data: body?.data ?? { hello: "world" },
    };

    await this.redis.publish(channel, JSON.stringify(payload));

    return { ok: true, channel, payload };
  }

  // ReportController 안에 추가
  @Post("advice/:jobId/cancel")
  async cancelAdvice(@Param("jobId") jobId: string) {
    const TTL = 600;

    // (1) cancel 플래그 저장 (나중에 워커가 체크하면 진짜 취소 가능)
    const cancelKey = `advice:job:${jobId}:cancel`;
    await this.redis.set(cancelKey, "1", "EX", TTL);

    // (2) (선택) UI에 "취소 요청됨" 이벤트도 뿌리기 (로그/UX 깔끔)
    const channel = `advice:job:${jobId}`;
    const msg = JSON.stringify({
      type: "progress",
      data: { jobId, stage: "cancel_requested" },
    });
    const lastKey = `advice:job:${jobId}:last`;

    await this.redis
      .multi()
      .set(lastKey, msg, "EX", TTL)
      .publish(channel, msg)
      .exec();

    // (3) (선택) 대기중(waiting/delayed)이면 큐에서 제거까지 하고 싶으면 아래 주석 해제
    // const job = await this.adviceQueue.getJob(jobId);
    // if (job) {
    //   const state = await job.getState();
    //   if (state === "waiting" || state === "delayed") {
    //     await job.remove();
    //     return { ok: true, jobId, status: "removed" };
    //   }
    // }

    return { ok: true, jobId, status: "cancel_requested" };
  }
}
