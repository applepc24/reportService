// apps/api/src/modules/naver-blog/naver-blog.module.ts
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { NaverBlogService } from './naver-blog.service';
import { NaverBlogController } from './naver-blog.controller';


@Module({
  imports: [
    HttpModule,   // 네이버 API 호출용
    ConfigModule, // env에서 키 읽어오기
  ],
  providers: [NaverBlogService],
  controllers: [NaverBlogController],
  exports: [NaverBlogService], // 나중에 ReportService 등에서 주입해서 쓰려고 export
})
export class NaverBlogModule {}