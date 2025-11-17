// apps/api/src/modules/naver-blog/naver-blog.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import { NaverBlogItem, NaverBlogSearchResult } from "./naver-blog.types";


function stripHtml(html?: string): string {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "");
}

@Injectable()
export class NaverBlogService {
  private readonly logger = new Logger(NaverBlogService.name);
  private readonly NAVER_BLOG_URL =
    "https://openapi.naver.com/v1/search/blog.json";

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async searchBlogs(query: string): Promise<NaverBlogSearchResult> {
    if (!query || !query.trim()) {
      return {
        lastBuildDate: "",
        total: 0,
        start: 1,
        display: 0,
        items: [],
      };
    }

    const clientId = this.configService.get<string>("NAVER_CLIENT_ID");
    const clientSecret = this.configService.get<string>("NAVER_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      this.logger.error("NAVER_CLIENT_ID or NAVER_CLIENT_SECRET is missing");
      throw new Error("Naver API key is not configured");
    }

    const params = {
      query,
      display: 10,
      start: 1,
      sort: "sim",
    };

    const res = await firstValueFrom(
      this.httpService.get(this.NAVER_BLOG_URL, {
        params,
        headers: {
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
        },
      })
    );

    const raw = res.data;

    const items: NaverBlogItem[] = (raw.items ?? []).map((item: any) => ({
      title: stripHtml(item.title),
      link: item.link,
      description: stripHtml(item.description),
      bloggerName: item.bloggername,
      postDate: item.postdate,
    }));

    return {
      lastBuildDate: raw.lastBuildDate,
      total: raw.total,
      start: raw.start,
      display: raw.display,
      items,
    };
  }

}
