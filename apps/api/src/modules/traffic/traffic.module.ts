// src/modules/traffic/traffic.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrafficMetric } from './entities/traffic-metric.entity';
import { TrafficService } from './traffic.service';
import { TrafficController } from './traffic.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TrafficMetric])],
  providers: [TrafficService],
  controllers: [TrafficController],
  exports: [TrafficService],
})
export class TrafficModule {}