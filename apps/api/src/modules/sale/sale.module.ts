import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalesMetric } from './entities/sales_metric.entity';
import { SalesService } from './sales.service';
import { SalesAdminController } from './sales.admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SalesMetric])],
  providers: [SalesService],
  controllers: [SalesAdminController],
  exports: [SalesService],
})
export class SalesModule {}