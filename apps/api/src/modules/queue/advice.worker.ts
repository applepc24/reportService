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
  
          this.logger.log(`✅ advice job received: ${job.id} dongId=${dongId}`);
  
          // 1) report 생성
          const report = await this.reportService.buildReport(dongId);
  
          // 2) advice 생성
          const advice = await this.reportService.generateAdvice(
            report,
            options,
            question
          );
  
          // 3) ✅ returnvalue로 저장될 값
          return {
            ok: true,
            advice,
            dong: report.dong,
            risk: report.risk,
          };
        },
        {
          connection: this.redis.duplicate(),
          concurrency: 2,
          limiter: {
            max: 10,
            duration: 60_000
          }
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