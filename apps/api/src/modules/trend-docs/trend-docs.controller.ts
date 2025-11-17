import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { TrendDocsService } from "./trend-docs.service";
import { CreateTrendDocDto } from "./dto/create-trend-doc.dto";
import { NaverBlogService } from "../naver-blog/naver-blog.service";
import { SEED_TREND_AREAS } from "./trend-area.constants";

@Controller("trend-docs")
export class TrendDocsController {
  constructor(
    private readonly trendDocsService: TrendDocsService,
    private readonly naverBlogService: NaverBlogService
  ) {}

  @Post()
  async create(@Body() dto: CreateTrendDocDto) {
    return this.trendDocsService.create(dto);
  }

  // 유사도 검색
  @Get("search")
  async search(@Query("q") q: string, @Query("limit") limit?: string) {
    if (!q) {
      return [];
    }
    const n = limit ? parseInt(limit, 10) : 5;
    return this.trendDocsService.search(q, n);
  }

  // 디버깅용
  @Get()
  async list() {
    return this.trendDocsService.findAll();
  }
  @Post("seed-all-from-naver")
  async seedAllFromNaver() {
    const results: any[] = [];

    for (const area of SEED_TREND_AREAS) {
      // 예: "성수동 술집", "홍대입구 술집" ...
      const query = `${area} 술집`;

      const blogSearchResult = await this.naverBlogService.searchBlogs(query);

      if (blogSearchResult.items?.length) {
        // TrendDocsService에 저장
        await this.trendDocsService.saveFromNaverBlogs(
          area,
          blogSearchResult.items
        );

        results.push({
          area,
          savedCount: blogSearchResult.items.slice(0, 5).length, // saveFromNaverBlogs에서 상위 5개만 쓰고 있으니까
          totalFromNaver: blogSearchResult.total,
        });
      } else {
        results.push({
          area,
          savedCount: 0,
          totalFromNaver: 0,
        });
      }
    }

    return {
      message: "seed-all-from-naver completed",
      results,
    };
  }
}
