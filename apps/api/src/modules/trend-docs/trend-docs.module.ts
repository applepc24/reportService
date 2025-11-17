import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TrendDoc } from "./trend-doc.entity";
import OpenAI from "openai";
import { TrendDocsService } from "./trend-docs.service";
import { TrendDocsController } from "./trend-docs.controller";
import { NaverBlogModule } from "../naver-blog/naver-blog.module";

@Module({
  imports: [TypeOrmModule.forFeature([TrendDoc]), NaverBlogModule],
  providers: [
    TrendDocsService,
    {
      provide: OpenAI,
      useFactory: () =>
        new OpenAI({
          apiKey: process.env.OPENAI_API_KEY!,
        }),
    },
  ],
  controllers: [TrendDocsController],
  exports: [TrendDocsService], // 나중에 report 모듈에서 재사용 가능
})
export class TrendDocsModule {}
