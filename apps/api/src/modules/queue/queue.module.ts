// src/modules/queue/queue.module.ts
import { Module, Global } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import IORedis, { RedisOptions } from "ioredis";

export const ADVICE_QUEUE = "advice-queue";
export const RAG_SAVE_QUEUE = "rag-save-queue";

@Global()
@Module({
  imports: [
    ConfigModule, // ✅ ConfigService 사용
  ],
  providers: [
    {
      provide: "BULLMQ_REDIS",
      useFactory: (config: ConfigService) => {
        const host = config.get<string>("REDIS_HOST") || "localhost";
        const port = Number(config.get<string>("REDIS_PORT") || 6379);
        const password = config.get<string>("REDIS_PASSWORD") || undefined;
        const tlsEnabled =
          (config.get<string>("REDIS_TLS_ENABLED") || "").toLowerCase() ===
          "true";

        const options: RedisOptions = {
          host,
          port,
          password,
          maxRetriesPerRequest: null, // BullMQ 권장
        };

        // ✅ ElastiCache(전송 암호화=ON)일 때 TLS 사용
        if (tlsEnabled) {
          options.tls = {}; // 기본 TLS 설정 (인증서는 VPC 내부라 기본으로 OK)
        }

        return new IORedis(options);
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
            backoff: { type: "exponential", delay: 5 },
          },
        });
      },
      inject: ["BULLMQ_REDIS"],
    },
    {
      provide: "RAG_SAVE_QUEUE",
      useFactory: (redis: IORedis) => {
        return new Queue(RAG_SAVE_QUEUE, {
          connection: redis,
          defaultJobOptions: {
            removeOnComplete: true,
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
          },
        });
      },
      inject: ["BULLMQ_REDIS"],
    },
  ],
  exports: ["BULLMQ_REDIS", "ADVICE_QUEUE", "RAG_SAVE_QUEUE"],
})
export class QueueModule {}
