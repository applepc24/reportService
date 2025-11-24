// src/modules/queue/queue.module.ts
import { Module, Global, forwardRef } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { AdviceWorker } from "./advice.worker";
import { ReportModule } from "../report/report.module";

export const ADVICE_QUEUE = "advice-queue";

@Global()
@Module({
  imports: [
    ConfigModule, // ✅ ConfigService 쓸거면 ConfigModule import
    forwardRef(() => ReportModule), // ✅ 순환참조 끊기
  ],
  providers: [
    {
      provide: "BULLMQ_REDIS",
      useFactory: (config: ConfigService) => {
        const host = config.get<string>("REDIS_HOST") || "localhost";
        const port = Number(config.get<string>("REDIS_PORT") || 6379);
        const password = config.get<string>("REDIS_PASSWORD") || undefined;

        return new IORedis({
          host,
          port,
          password,
          maxRetriesPerRequest: null, // BullMQ 권장
        });
      },
      inject: [ConfigService],
    },
    {
      provide: "ADVICE_QUEUE",
      useFactory: (redis: IORedis) => {
        return new Queue(ADVICE_QUEUE, {
          connection: redis,
          defaultJobOptions: {
            removeOnComplete: { age: 60 * 10, count: 1000 }, // 10분 or 1000개까지 유지
            removeOnFail: { age: 60 * 60, count: 1000 }, // 실패는 1시간 유지
            attempts: 3,
            backoff: { type: "exponential", delay: 5e000 },
          },
        });
      },
      inject: ["BULLMQ_REDIS"],
    },
  ],
  exports: ["BULLMQ_REDIS", "ADVICE_QUEUE"],
})
export class QueueModule {}
