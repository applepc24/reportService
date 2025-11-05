import { Module } from '@nestjs/common';
import { ReportModule } from './modules/report/report.module';

@Module({
  imports: [ReportModule],
})
export class AppModule {}