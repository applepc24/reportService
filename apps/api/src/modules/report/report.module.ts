import { Module } from '@nestjs/common';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { DongModule } from '../dong/dong.module';
import { PubModule } from '../pub/pub.module';

@Module({
  imports: [DongModule, PubModule],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}