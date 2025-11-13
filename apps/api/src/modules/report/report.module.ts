import { Module } from "@nestjs/common";
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


@Module({
  imports: [
    DongModule,
    PubModule,
    ReviewModule,
    TrafficModule,
    KakaoModule,
    StoreModule,
    TAChangeModule,
    SalesModule,
    FacilityModule
  ],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}
