import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FacilityMetric } from './entities/facility_metric.entity';
import { FacilityService } from './facility.service';
import { FacilityAdminController } from './facility.admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([FacilityMetric])],
  providers: [FacilityService],
  controllers: [FacilityAdminController],
  exports: [FacilityService],
})
export class FacilityModule {}