// src/modules/pub/pub.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PoiPub } from './entities/pub.entity';
import { PubService } from './pub.service';
import { PubController } from './pub.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PoiPub])],
  providers: [PubService],
  controllers: [PubController],
  exports: [PubService],
})
export class PubModule {}