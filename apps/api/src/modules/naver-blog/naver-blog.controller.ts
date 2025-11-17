// apps/api/src/modules/naver-blog/naver-blog.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { NaverBlogService } from './naver-blog.service';

@Controller('naver')
export class NaverBlogController {
  constructor(private readonly naverBlogService: NaverBlogService) {}

  @Get('blog')
  async searchBlog(@Query('query') query: string) {
    // 간단 방어코드
    const q = query?.trim();
    if (!q) {
      return { items: [], total: 0, message: 'query 파라미터를 입력하세요.' };
    }

    return this.naverBlogService.searchBlogs(q);
  }
}