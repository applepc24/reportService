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
    StoreModule
  ],
})
export class AppModule {}