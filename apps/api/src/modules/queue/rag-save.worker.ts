// src/modules/queue/rag-save.worker.ts
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Inject,
} from "@nestjs/common";
import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { RAG_SAVE_QUEUE } from "./queue.module";
import { TrendDocsService } from "../trend-docs/trend-docs.service";
import { NaverBlogItem } from "../naver-blog/naver-blog.types";

type RagSaveJobData = {
    trendAreaKeyword: string;   // 예: "역촌동" or "역촌동 와인바"
    items: NaverBlogItem[];
  };
  

@Injectable()
export class RagSaveWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RagSaveWorker.name);
  private worker!: Worker;

  constructor(
    @Inject("BULLMQ_REDIS") private readonly redis: IORedis,
    private readonly trendDocsService: TrendDocsService
  ) {}

  onModuleInit() {
    this.worker = new Worker<RagSaveJobData>(
      RAG_SAVE_QUEUE,
      async (job: Job<RagSaveJobData>) => {
        const { trendAreaKeyword, items } = job.data;

        this.logger.log(
          `✅ rag-save job received: ${job.id} area=${trendAreaKeyword} items=${items.length}`
        );

        await this.trendDocsService.saveFromNaverBlogs(trendAreaKeyword, items);

        return { ok: true };
      },
      {
        connection: this.redis.duplicate(),
        concurrency: 1, // 저장 작업은 천천히 안전하게
      }
    );

    this.worker.on("completed", (job) => {
      this.logger.log(`✅ rag-save job completed: ${job.id}`);
    });

    this.worker.on("failed", (job, err) => {
      this.logger.error(`🔥 rag-save job failed: ${job?.id}`, err.stack);
    });

    this.logger.log("RagSaveWorker started.");
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
