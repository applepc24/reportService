import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ReportModule } from './modules/report/report.module';
import { DatabaseModule } from './config/database.module';
import { DongModule } from './modules/dong/dong.module';
import { PubModule } from './modules/pub/pub.module';
import { ReviewModule } from './modules/review/review.module';
import { TrafficMetric } from './modules/traffic/entities/traffic-metric.entity';
import { TrafficModule } from './modules/traffic/traffic.module';
import { StoreModule } from './modules/store/store.module';
import { SalesModule } from './modules/sale/sale.module';
import { TrendDocsModule } from "./modules/trend-docs/trend-docs.module";
import { NaverBlogModule } from './modules/naver-blog/naver-blog.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ReportModule,
    DatabaseModule,
    DongModule,
    PubModule,
    ReviewModule,
    TrafficMetric,
    TrafficModule,
    StoreModule,
    SalesModule,
    TrendDocsModule,
    NaverBlogModule,
    HealthModule,
  ],
})
export class AppModule {}