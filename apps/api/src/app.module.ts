import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ReportModule } from './modules/report/report.module';
import { DatabaseModule } from './config/database.module';
import { DongModule } from './modules/dong/dong.module';
import { PubModule } from './modules/pub/pub.module';
import { ReviewModule } from './modules/review/review.module';

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
  ],
})
export class AppModule {}