// apps/api/src/modules/kakao/kakao.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KakaoLocalService } from './kakao-local.service';

@Module({
  imports: [ConfigModule], // ConfigService 쓰니까
  providers: [KakaoLocalService],
  exports: [KakaoLocalService], // 다른 모듈에서 쓰게 export
})
export class KakaoModule {}