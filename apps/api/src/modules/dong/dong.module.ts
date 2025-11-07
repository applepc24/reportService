// src/modules/dong/dong.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dong } from './entities/dong.entity';
import { DongService } from './dong.service';
import { DongController } from './dong.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Dong])], // ✅ 이 모듈에서 Dong 사용
  providers: [DongService],
  controllers: [DongController],
  exports: [DongService],
})
export class DongModule {}