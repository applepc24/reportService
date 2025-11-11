import { Module } from "@nestjs/common";
import { ReportController } from "./report.controller";
import { ReportService } from "./report.service";
import { DongModule } from "../dong/dong.module";
import { PubModule } from "../pub/pub.module";
import { ReviewModule } from "../review/review.module";
import { TrafficModule } from "../traffic/traffic.module";
import { KakaoModule } from "../kakao/kakao.module";

@Module({
  imports: [DongModule, PubModule, ReviewModule, TrafficModule, KakaoModule],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}
