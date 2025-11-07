// src/modules/report/report.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';
import { DongService } from '../dong/dong.service';
import { PubService } from '../pub/pub.service';
import { ReportResponse, ReportMonthlyStat } from './report.types';


@Injectable()
export class ReportService {
  private openai: OpenAI;
  private modelName: string;

  constructor(
    private readonly dongService: DongService,
    private readonly pubService: PubService,
    private readonly configService: ConfigService,
    // 나중에 ReviewService, RAGService도 여기로 추가
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.modelName = this.configService.get<string>('OPENAI_MODEL') ?? 'gpt-4o-mini';

    if (!apiKey) {
      // 디버깅용: 키 없으면 서버 뜰 때 바로 에러 던져버리기
      throw new Error('OPENAI_API_KEY is not set');
    }

    this.openai = new OpenAI({ apiKey });
  }

  // GET /report?dongId=1 에서 쓸 핵심 함수
  async buildReport(dongId: number): Promise<ReportResponse> {
    // 1) 동 정보 가져오기
    const dong = await this.dongService.findById(dongId);
    if (!dong) {
      throw new NotFoundException(`dong ${dongId} not found`);
    }

    // 2) 이 동네 상위 술집 N개 가져오기
    const pubs = await this.pubService.getTopPubsByDong(dongId, 5);

    // 3) summary 계산 (지금은 Top N 기준으로 임시 계산)
    const pubCount = pubs.length;

    const avgRating =
      pubs.length > 0
        ? Number(
            (
              pubs
                .map((p) => Number(p.rating ?? 0))
                .reduce((a, b) => a + b, 0) / pubs.length
            ).toFixed(1),
          )
        : null;

    const reviews = pubs
      .map((p) => p.reviewCount)
      .reduce((a, b) => a + b, 0);

    // 4) 월별 통계는 지금은 빈 배열 → 나중에 review 테이블 집계로 채울 예정
    const monthly: ReportMonthlyStat[] = [];

    // 5) 최종 ReportResponse 형태로 리턴
    return {
      dong: {
        id: dong.id,
        name: dong.name,
        code: dong.code ?? null,
      },
      summary: {
        pubCount,
        avgRating,
        reviews,
      },
      topPubs: pubs.map((p) => ({
        name: p.name,
        rating:
          p.rating !== null && p.rating !== undefined
            ? Number(p.rating)
            : null,
        reviewCount: p.reviewCount,
      })),
      monthly,
    };
  }
  async generateReportText(report: ReportResponse): Promise<string> {
    const reportJson = JSON.stringify(report, null, 2);

    const systemPrompt = `
너는 서울 동네 술집 창업 컨설턴트야.
아래 JSON 데이터를 기반으로,
1인 창업자가 이해하기 쉬운 한국어 리포트를 써줘.

규칙:
- JSON에 없는 정보는 지어내지 말 것
- 동 이름, 요약, 상위 술집 특징, 리뷰/평점의 느낌을 설명
- 너무 길지 않게, 4~6개의 문단으로 정리
`;

    const userPrompt = `
다음은 특정 행정동에 대한 술집 데이터야.
이 데이터를 기반으로 창업자를 위한 분석 리포트를 작성해줘.

JSON:
${reportJson}
`;

    const completion = await this.openai.chat.completions.create({
      model: this.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    return completion.choices[0]?.message?.content ?? '';
  }
}