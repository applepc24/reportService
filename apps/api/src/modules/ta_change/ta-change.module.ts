// src/modules/ta-change/ta-change.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TAChangeMetric } from './entities/ta_change_metric.entity';
import { TAChangeService } from './ta-change.service';
import { TAChangeAdminController } from './ta-change.admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TAChangeMetric])],
  providers: [TAChangeService],
  controllers: [TAChangeAdminController],
  exports: [TAChangeService],
})
export class TAChangeModule {}