// src/modules/queue/advice.worker.ts
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Inject,
} from "@nestjs/common";
import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { ADVICE_QUEUE } from "./queue.module";
import { ReportService } from "../report/report.service";
import { AdviceOptions } from "../report/report.types";

type AdviceJobData = {
  dongId: number;
  options: AdviceOptions;
  question: string;
};

@Injectable()
export class AdviceWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdviceWorker.name);
  private worker!: Worker;

  constructor(
    @Inject("BULLMQ_REDIS") private readonly redis: IORedis,
    private readonly reportService: ReportService
  ) {}

  onModuleInit() {
    this.worker = new Worker<AdviceJobData, any>(
      ADVICE_QUEUE,
      async (job: Job<AdviceJobData>) => {
        const { dongId, options, question } = job.data;

        const jobId = String(job.id);
        const channel = `advice:job:${jobId}`;
        this.logger.log(`[Worker] publish channel=${channel}`);

        const TTL = 600;

        const lastKey = `advice:job:${jobId}:last`;
        const textKey = `advice:job:${jobId}:text`; // ✅ 누적 텍스트
        const seqKey = `advice:job:${jobId}:seq`; // ✅ 마지막 seq
        const stageKey = `advice:job:${jobId}:stage`; // ✅ 마지막 stage

        const pub = async (type: string, data: any) => {
          const msg = JSON.stringify({ type, data: { jobId, ...data } });

          const m = this.redis
            .multi()
            .set(lastKey, msg, "EX", TTL)
            .publish(channel, msg);

          // ✅ progress면 stage 저장
          if (type === "progress" && data?.stage) {
            m.set(stageKey, String(data.stage), "EX", TTL);
          }

          await m.exec();
        };

        this.logger.log(`✅ advice job received: ${jobId} dongId=${dongId}`);

        try {
          await pub("progress", { stage: "start" });

          // 1) report 생성
          await pub("progress", { stage: "fetch_report" });
          const report = await this.reportService.buildReport(dongId);
          await pub("progress", {
            stage: "fetch_report_done",
            dong: report.dong?.name,
          });

          // 2) advice 생성
          await pub("progress", { stage: "generate_advice" });
          let seq = 0;
          const advice = await this.reportService.generateAdvice(
            report,
            options,
            question,
            async (deltaText) => {
              if (!deltaText) return; // ✅ 안전장치 (빈 delta 방지)

              seq += 1;

              const msg = JSON.stringify({
                type: "delta",
                data: { jobId, seq, text: deltaText },
              });

              await this.redis
                .multi()
                .append(textKey, deltaText)
                .set(seqKey, String(seq), "EX", TTL)
                .set(lastKey, msg, "EX", TTL)
                .publish(channel, msg)
                .exec();
            },
            async (stage, meta) => {
              await pub("progress", { stage, ...(meta ?? {}) });
            }
          );
          await pub("progress", { stage: "generate_advice_done" });

          // 3) done publish (최종 결과를 SSE로도 내려보냄)
          const result = {
            ok: true,
            advice,
            dong: report.dong,
            risk: report.risk,
          };

          await pub("done", { result });

          return result;
        } catch (err: any) {
          this.logger.error(
            `🔥 advice job failed: ${job?.id}`,
            err?.stack ?? String(err)
          );

          await pub("error", {
            message: "job_failed",
            detail: err?.message ?? String(err),
          });

          throw err;
        }
      },
      {
        connection: this.redis.duplicate(),
        concurrency: 5,
        limiter: {
          max: 10,
          duration: 60_000,
        },
      }
    );

    this.worker.on("completed", (job) => {
      this.logger.log(`🎉 advice job completed: ${job.id}`);
    });

    this.worker.on("failed", (job, err) => {
      this.logger.error(`🔥 advice job failed: ${job?.id}`, err.stack);
    });

    this.logger.log("AdviceWorker started.");
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
