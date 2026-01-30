// src/modules/trend-docs/trend-docs.service.ts
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import OpenAI from "openai";
import { Repository } from "typeorm";
import { TrendDoc } from "./trend-doc.entity";
import { CreateTrendDocDto } from "./dto/create-trend-doc.dto";
import { NaverBlogItem } from "../naver-blog/naver-blog.types";
import { isPerfFakeLLM, delay } from "../../common/utils/perf.util";

export interface TrendDocSearchResult {
  id: number;
  source: string;
  content: string;
  area?: string;
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

  async embedText(text: string, delayMs = 5): Promise<string> {
    if (isPerfFakeLLM()) {
      // DB 저장 시간만 측정 (호출부에서 delayMs 조절 가능)
      await delay(delayMs);
      return `[${new Array(1536).fill("0").join(",")}]`;
    }
  
    const emb = await this.openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
  
    const vector = emb.data[0].embedding;
    return `[${vector.join(",")}]`;
  }

  /**
   * 네이버 블로그 검색 결과를 TrendDocs 테이블에 저장 + 임베딩까지 생성
   * @param trendAreaKeyword '성수동', '홍대입구' 같은 상권 키워드
   * @param items 네이버 블로그 검색 결과 item 배열
   */
  async saveFromNaverBlogs(
    trendAreaKeyword: string,
    items: NaverBlogItem[]
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
    }
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

    const vectorString = await this.embedText(dto.content, 20);

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
    const vectorString = await this.embedText(dto.content);

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
  async search(query: string, limit = 20): Promise<TrendDocSearchResult[]> {
    let vectorString: string;

    if (isPerfFakeLLM()) {
      await delay(10);
      vectorString = `[${Array(1536).fill(0).join(",")}]`;
    } else {
      const emb = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: query,
      });
      const vector = emb.data[0].embedding;
      vectorString = `[${vector.join(",")}]`;
    }
    const rows: TrendDocSearchResult[] = await this.repo.query(
      `
      SELECT
        id,
        source,
        area,
        content,
        embedding <-> $1::vector AS distance
      FROM trend_docs
      ORDER BY embedding <-> $1::vector
      LIMIT $2
      `,
      [vectorString, limit]
    );

    return rows;
  }

  private calcLexicalScore(query: string, docText: string): number {
    const q = (query || "").toLowerCase();
    const d = (docText || "").toLowerCase();

    // 아주 단순한 토큰화: 공백/쉼표 기준
    const qTokens = q
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    if (qTokens.length === 0) return 0;

    let hit = 0;
    for (const t of qTokens) {
      if (t.length < 2) continue; // 1글자 토큰은 노이즈라 제외
      if (d.includes(t)) hit++;
    }

    // hit 비율(0~1)
    return hit / qTokens.length;
  }

  // content에서 [작성일] YYYYMMDD 추출
  private extractPostDate(docText: string): Date | null {
    if (!docText) return null;

    // 예: [작성일] 20251121
    const m = docText.match(/\[작성일\]\s*([0-9]{8})/);
    if (!m) return null;

    const y = parseInt(m[1].slice(0, 4), 10);
    const mo = parseInt(m[1].slice(4, 6), 10) - 1;
    const d = parseInt(m[1].slice(6, 8), 10);

    const dt = new Date(y, mo, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  /**
   * 최신성 보너스: 최근일수록 +ε
   * - 0~3개월: +0.01
   * - 3~12개월: 선형으로 0.01 -> 0 감소
   * - 12개월~ : 0
   */
  private calcFreshnessBonus(docText: string): number {
    const dt = this.extractPostDate(docText);
    if (!dt) return 0;

    const now = new Date();
    const diffMs = now.getTime() - dt.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    const days3m = 90;
    const days12m = 365;

    if (diffDays <= days3m) return 0.01;

    if (diffDays <= days12m) {
      const t = (diffDays - days3m) / (days12m - days3m); // 0~1
      return 0.01 * (1 - t); // 0.01 -> 0 선형 감소
    }

    return 0;
  }

  async searchHybrid(
    query: string,
    finalK = 5,
    recallK = 20,
    areaHint?: string // ✅ 추가
  ) {
    const recalled = await this.search(query, recallK);
    if (!recalled || recalled.length === 0) return [];

    const reranked = recalled
      .map((doc) => {
        const lexical = this.calcLexicalScore(query, doc.content);
        const vectorScore = 1 / (1 + (doc.distance ?? 0));

        const freshnessBonus = this.calcFreshnessBonus(doc.content);

        // ✅ area bonus (아주 약하게)

        let finalScore =
        vectorScore * 0.7 +
        lexical * 0.3 +
        freshnessBonus;

        // ✅ area는 "약한 힌트"만
        if (areaHint && doc.area && doc.area.includes(areaHint)) {
          finalScore += 0.03; // << 강도 낮게 (0.02~0.05 사이 추천)
        }

        return { ...doc, lexical, vectorScore, finalScore };
      })
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, finalK);

    return reranked;
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
