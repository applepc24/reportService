// apps/api/src/modules/store/store.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreMetric } from './entities/store_metric.entity';
import { StoreService } from './store.service';
import { StoreAdminController } from './store.admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([StoreMetric])],
  providers: [StoreService],
  controllers: [StoreAdminController],
  exports: [StoreService],
})
export class StoreModule {}