// src/modules/queue/queue-worker.module.ts
import { Module, forwardRef } from "@nestjs/common";
import { QueueModule } from "./queue.module";
import { ReportModule } from "../report/report.module";
import { AdviceWorker } from "./advice.worker";
import { RagSaveWorker } from "./rag-save.worker";
import { TrendDocsModule } from "../trend-docs/trend-docs.module";

@Module({
  imports: [
    QueueModule,
    forwardRef(() => ReportModule),
    TrendDocsModule,
  ],
  providers: [AdviceWorker, RagSaveWorker],
})
export class QueueWorkerModule {}