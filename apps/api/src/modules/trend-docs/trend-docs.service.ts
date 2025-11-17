// src/modules/trend-docs/trend-docs.service.ts
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import OpenAI from "openai";
import { Repository } from "typeorm";
import { TrendDoc } from "./trend-doc.entity";
import { CreateTrendDocDto } from "./dto/create-trend-doc.dto";
import { NaverBlogItem } from "../naver-blog/naver-blog.types";

export interface TrendDocSearchResult {
  id: number;
  source: string;
  content: string;
  distance: number;
}

// 간단 HTML 태그 제거 유틸
function stripHtml(html?: string): string {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "").trim();
}

@Injectable()
export class TrendDocsService {
  constructor(
    @InjectRepository(TrendDoc)
    private readonly repo: Repository<TrendDoc>,
    private readonly openai: OpenAI
  ) {}

  /**
   * 네이버 블로그 검색 결과를 TrendDocs 테이블에 저장 + 임베딩까지 생성
   * @param trendAreaKeyword '성수동', '홍대입구' 같은 상권 키워드
   * @param items 네이버 블로그 검색 결과 item 배열
   */
  async saveFromNaverBlogs(
    trendAreaKeyword: string,
    items: NaverBlogItem[],
  ): Promise<void> {
    if (!items || items.length === 0) return;

    // 너무 많이 안 넣고 상위 5개만
    const topItems = items.slice(0, 5);

    for (const item of topItems) {
      const cleanTitle = stripHtml(item.title);
      const cleanDesc = stripHtml(item.description);

      // 네이버 블로그 링크 기준으로 unique ID 생성
      const externalId = `naver-blog:${item.link}`;

      const combinedContent = `
[상권] ${trendAreaKeyword}
[제목] ${cleanTitle}
[요약] ${cleanDesc}
[블로거] ${item.bloggerName}
[링크] ${item.link}
[작성일] ${item.postDate}
`.trim();

      // 🔹 중복이면 createIfNotExists가 알아서 스킵
      await this.createIfNotExists({
        source: "naver-blog",
        content: combinedContent,
        externalId,
        area: trendAreaKeyword,
      });
    }
  }

  /**
   * externalId 기준으로 중복 방지 저장
   */
  async createIfNotExists(
    dto: CreateTrendDocDto & {
      externalId?: string;
      area?: string;
    },
  ) {
    if (dto.externalId) {
      const exists = await this.repo.findOne({
        where: { externalId: dto.externalId },
      });
      if (exists) {
        // 이미 있으면 그대로 리턴
        return exists;
      }
    }

    // 없으면 평소 create와 동일한 흐름
    const emb = await this.openai.embeddings.create({
      model: "text-embedding-3-small",
      input: dto.content,
    });

    const vector = emb.data[0].embedding;
    const vectorString = `[${vector.join(",")}]`;

    const doc = this.repo.create({
      source: dto.source,
      content: dto.content,
      embedding: vectorString,
      externalId: dto.externalId,
      area: dto.area,
    });

    return this.repo.save(doc);
  }

  /**
   * 기본 수동 생성용 (seed나 테스트용)
   */
  async create(dto: CreateTrendDocDto) {
    const emb = await this.openai.embeddings.create({
      model: "text-embedding-3-small",
      input: dto.content,
    });

    const vector = emb.data[0].embedding;
    const vectorString = `[${vector.join(",")}]`;

    const doc = this.repo.create({
      source: dto.source,
      content: dto.content,
      embedding: vectorString,
    });

    return this.repo.save(doc);
  }

  /**
   * pgvector 기반 코사인/유클리드 거리 검색
   */
  async search(query: string, limit = 5): Promise<TrendDocSearchResult[]> {
    const emb = await this.openai.embeddings.create({
      model: "text-embedding-3-small",
      input: query,
    });

    const vector = emb.data[0].embedding;
    const vectorString = `[${vector.join(",")}]`;

    const rows: TrendDocSearchResult[] = await this.repo.query(
      `
      SELECT
        id,
        source,
        content,
        embedding <-> $1::vector AS distance
      FROM trend_docs
      ORDER BY embedding <-> $1::vector
      LIMIT $2
      `,
      [vectorString, limit],
    );

    return rows;
  }

  /**
   * 디버깅용 최근 20개
   */
  async findAll() {
    return this.repo.find({
      order: { id: "DESC" },
      take: 20,
    });
  }
}