import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ReportController } from "./report.controller";
import { ReportService } from "./report.service";
import { DongModule } from "../dong/dong.module";
import { PubModule } from "../pub/pub.module";
import { ReviewModule } from "../review/review.module";
import { TrafficModule } from "../traffic/traffic.module";
import { StoreModule } from "../store/store.module";
import { KakaoModule } from "../kakao/kakao.module";
import { TAChangeModule } from "../ta_change/ta-change.module";
import { SalesModule } from "../sale/sale.module";
import { FacilityModule } from "../facility/facility.module";
import { DongQuarterSummary } from "../summary/entities/dong_quarter_summary";
import { TrendDocsModule } from "../trend-docs/trend-docs.module";
import { NaverBlogModule } from "../naver-blog/naver-blog.module";
import { QueueModule } from "../queue/queue.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([DongQuarterSummary]),
    DongModule,
    PubModule,
    ReviewModule,
    TrafficModule,
    KakaoModule,
    StoreModule,
    TAChangeModule,
    SalesModule,
    FacilityModule,
    TrendDocsModule,
    NaverBlogModule,
    QueueModule,
  ],
  controllers: [ReportController],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportModule {}
