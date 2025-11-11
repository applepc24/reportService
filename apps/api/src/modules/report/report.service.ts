// src/modules/report/report.service.ts
import { Injectable, NotFoundException } from "@nestjs/common";
import OpenAI from "openai";
import { ConfigService } from "@nestjs/config";
import { DongService } from "../dong/dong.service";
import { PubService } from "../pub/pub.service";
import { ReviewService } from "../review/review.service";
import { TrafficService } from "../traffic/traffic.service";
import {
  ReportResponse,
  ReportMonthlyStat,
  AdviceResponse,
  AdviceOptions,
} from "./report.types";

@Injectable()
export class ReportService {
  private openai: OpenAI;
  private modelName: string;

  constructor(
    private readonly dongService: DongService,
    private readonly pubService: PubService,
    private readonly reviewService: ReviewService,
    private readonly trafficService: TrafficService,
    private readonly configService: ConfigService // 나중에 ReviewService, RAGService도 여기로 추가
  ) {
    const apiKey = this.configService.get<string>("OPENAI_API_KEY");
    this.modelName =
      this.configService.get<string>("OPENAI_MODEL") ?? "gpt-4o-mini";

    if (!apiKey) {
      // 디버깅용: 키 없으면 서버 뜰 때 바로 에러 던져버리기
      throw new Error("OPENAI_API_KEY is not set");
    }

    this.openai = new OpenAI({ apiKey });
  }

  /**
   * 월별 리뷰 수 배열을 받아서
   * "리뷰가 증가/감소/안정" 같은 한 줄 요약을 만들어준다.
   */
  private buildReviewTrendSummary(monthly: ReportMonthlyStat[]): string {
    if (!monthly || monthly.length === 0) {
      return "리뷰 추이 데이터를 확인할 수 없습니다.";
    }

    if (monthly.length === 1) {
      return `데이터가 한 달 분만 있어, 리뷰 추세를 판단하기 어렵습니다. (해당 월 리뷰 수: ${monthly[0].reviews}건)`;
    }

    const first = monthly[0];
    const last = monthly[monthly.length - 1];
    const diff = last.reviews - first.reviews;

    const peak = monthly.reduce(
      (max, cur) => (cur.reviews > max.reviews ? cur : max),
      monthly[0]
    );

    // 🔹 전체 리뷰 수가 너무 적으면 "추세"라고 부르지 말자
    const total = monthly.reduce((sum, m) => sum + m.reviews, 0);
    if (total < 30) {
      return (
        `월별 리뷰 데이터가 총 ${total}건으로 매우 적어, 뚜렷한 추세를 말하기는 어렵습니다. ` +
        `가장 리뷰가 많았던 달은 ${peak.month}(${peak.reviews}건) 정도로 참고만 할 수 있는 수준입니다.`
      );
    }

    let direction: string;
    if (diff > 0) {
      direction = "최근 몇 달 동안 리뷰 수가 증가하는 추세입니다.";
    } else if (diff < 0) {
      direction = "최근 몇 달 동안 리뷰 수가 감소하는 추세입니다.";
    } else {
      direction =
        "최근 몇 달 동안 리뷰 수는 큰 변화 없이 비슷한 수준을 유지하고 있습니다.";
    }

    return [
      direction,
      `첫 달 리뷰 수: ${first.reviews}건, 마지막 달 리뷰 수: ${last.reviews}건.`,
      `가장 리뷰가 많았던 달은 ${peak.month}로, 리뷰 ${peak.reviews}건을 기록했습니다.`,
    ].join(" ");
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
            ).toFixed(1)
          )
        : null;

    const reviews = pubs.map((p) => p.reviewCount).reduce((a, b) => a + b, 0);

    // 4) 월별 통계는 지금은 빈 배열 → 나중에 review 테이블 집계로 채울 예정
    const monthlyRaw = await this.reviewService.getMonthlyStatsByDong(dongId);

    const monthly: ReportMonthlyStat[] = monthlyRaw.map((m) => ({
      month: m.month, // 'YYYY-MM-01'
      reviews: m.reviews,
    }));

    const trafficMetric = await this.trafficService.getLatestByDongName(
      dong.name
    );
    const trafficSummary = this.trafficService.calcSummary(trafficMetric);
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
          p.rating !== null && p.rating !== undefined ? Number(p.rating) : null,
        reviewCount: p.reviewCount,
      })),
      monthly,
      traffic: trafficSummary,
    };
  }
  async generateReportText(report: ReportResponse): Promise<string> {
    const reportJson = JSON.stringify(report, null, 2);
    const dongName = report.dong.name;

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
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
너는 서울 각 행정동의 술집 상권을 분석하는 데이터 리포트 작성 전문가야.
출력은 반드시 **한국어 마크다운(Markdown)** 형식으로 작성해.
- 제목과 섹션은 #, ## 로 구분
- 리스트는 - 로 작성
- 표는 Markdown 테이블로 표현
- 숫자, 비율, 추세를 명확하게 서술

리포트 구성 예시는 다음과 같아:
## 상권 개요
## 인기 술집 TOP 3
## 소비자 리뷰 요약
## 가격 및 경쟁 전략
## 리스크 & 기회
## 요약 결론
`,
        },
        {
          role: "user",
          content: `
          다음 JSON 데이터를 기반으로 "${dongName}" 행정동의 술집 상권 분석 리포트를 작성해줘.
          가능하다면 수치를 요약해서 트렌드를 설명해줘.
          1인 술집 창업자가 이해하기 쉬운 언어로 작성해줘.

          JSON:
          ${reportJson}
`,
        },
      ],
    });

    return completion.choices[0]?.message?.content ?? "";
  }

  async generateAdvice(
    report: ReportResponse,
    options: AdviceOptions,
    question: string
  ): Promise<string> {
    // 1) 먼저 JSON 리포트 만들기 (DB에서 데이터 수집)
    const { dong, summary, topPubs, monthly } = report;
    const dongName = dong.name;

    const reviewTrendSummary = this.buildReviewTrendSummary(monthly);

    const reportJson = JSON.stringify(
      { dong, summary, topPubs, monthly },
      null,
      2
    );
    const optionsJson = JSON.stringify(options, null, 2);

    // 2) LLM에게 줄 system / user 프롬프트 구성
    const completion = await this.openai.chat.completions.create({
      model: this.modelName,
      messages: [
        {
          role: "system",
          content: `
너는 서울 각 행정동의 술집 상권을 분석해서
1인 창업자에게 조언을 해주는 컨설턴트야.

- 출력은 반드시 **한국어 마크다운(Markdown)** 으로 작성해.
- 제목과 섹션은 ##, ### 를 사용해라.
- 리스트는 - 를 사용해라.
- JSON에 없는 사실은 절대 지어내지 말 것.
- 숫자(평점, 리뷰 수, 상위 술집 특성)를 적극적으로 활용해 트렌드를 설명해라.

JSON 상권 데이터에 연령대나 컨셉 관련 수치(예: 연령대 비율, 업종별 비중 등)가 없는 경우:

- "데이터 기준으로는 연령 분포/컨셉 트렌드 정보가 부족합니다."라고 분명히 밝힌다.
- 연령대 비율, 트렌드, 정확한 숫자는 추측해서 만들지 않는다.
- 대신, 일반적인 창업 컨설팅 경험에 기반한 조언(예: 20-30대를 타깃으로 할 때 보통 유효한 전략)을
  이 창업자의 조건(budgetLevel, concept, targetAge 등)에 맞춰 제안한다.
          `.trim(),
        },
        {
          role: "user",
          content: `
[상권 데이터(JSON)]
${reportJson}

[창업자 조건(JSON)]
${optionsJson}

[월별 리뷰 추이 요약]
${reviewTrendSummary}

[창업자의 질문]
${question}

위 데이터를 기반으로 **"${dongName}" 행정동**에서 술집을 창업하려는 1인 창업자를 위해
아래 구조로 리포트를 작성해줘.

## 상권 개요
- 이 동네 술집 수, 평균 평점, 리뷰 수 등 핵심 숫자 요약
- 위의 "월별 리뷰 추이 요약"을 자연스럽게 포함해서 설명

## 인기 술집/경쟁 구도
- 상위 술집들의 공통점 (평점, 리뷰 수, 분위기 추정 등)
- 예산/컨셉/타깃 연령을 기준으로 이 창업자가 어디에 포지셔닝하면 좋을지

## 가격 및 운영 전략
- 예산 수준(budgetLevel)을 고려해서 현실적인 가격대/운영 전략 제안

## 리스크 & 기회
- 이 상권에서 조심해야 할 점
- 이 창업자의 조건에서 활용할 수 있는 기회

## 한 줄 요약 조언
- 이 창업자에게 주는 핵심 한 줄 조언
          `.trim(),
        },
      ],
    });

    const adviceText = completion.choices[0]?.message?.content ?? "";

    return adviceText;
  }
}
