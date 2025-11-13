// src/modules/report/report.service.ts
import { Injectable, NotFoundException } from "@nestjs/common";
import OpenAI from "openai";
import { ConfigService } from "@nestjs/config";
import { DongService } from "../dong/dong.service";
import { PubService } from "../pub/pub.service";
import { ReviewService } from "../review/review.service";
import { TrafficService } from "../traffic/traffic.service";
import { StoreService } from "../store/store.service";
import { KakaoLocalService } from "../kakao/kakao-local.service";
import { TAChangeService } from "../ta_change/ta-change.service";
import {
  ReportResponse,
  ReportMonthlyStat,
  AdviceResponse,
  AdviceOptions,
} from "./report.types";
import { SalesService } from "../sale/sales.service";
import { FacilityService } from "../facility/facility.service";

@Injectable()
export class ReportService {
  private openai: OpenAI;
  private modelName: string;

  constructor(
    private readonly dongService: DongService,
    private readonly trafficService: TrafficService,
    private readonly storeService: StoreService,
    private readonly kakaoLocalService: KakaoLocalService,
    private readonly taChangeService: TAChangeService,
    private readonly salesService: SalesService,
    private readonly facility: FacilityService,
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

    const dongCode = dong.code; // 예: '11440730'
    const dongName = dong.name; // 예: '연남동'

    // 2) 트래픽 + 점포 + 카카오 한 번에 병렬 호출
    const [metric, storeSummary, kakaoPlaces, taMetric, salesSummary, facility] = await Promise.all([
      dongCode ? this.trafficService.getLatestByDongCode(dongCode) : null,
      dongCode ? this.storeService.getAlcoholSummaryByDongCode(dongCode) : null,
      this.kakaoLocalService.searchPubsByDongName(dongName, { size: 5 }),
      this.taChangeService.getLatestByDongCode(dong.code),
      this.salesService.getLatestAlcoholSalesSummaryByDongCode(dongCode),
      this.facility.getLatestSummaryByDongCode(dong.code),
    ]);

    // 3) 트래픽 요약 계산 (없으면 null)
    const trafficSummary = metric
      ? this.trafficService.calcSummary(metric)
      : null;

    const taChange = taMetric
      ? {
          period: taMetric.period,
          index: taMetric.changeIndex,
          indexName: taMetric.changeIndexName,
          opRunMonthAvg: taMetric.opRunMonthAvg,
          clRunMonthAvg: taMetric.clRunMonthAvg,
          seoulOpRunMonthAvg: taMetric.seoulOpRunMonthAvg,
          seoulClRunMonthAvg: taMetric.seoulClRunMonthAvg,
        }
      : null;

    // 4) 카카오 결과를 우리가 쓰기 쉬운 구조로 변환
    const kakaoPubs = kakaoPlaces.map((p) => ({
      name: p.placeName,
      category: p.categoryName,
      url: p.placeUrl,
    }));

    // 5) 프론트에서 보여줄 “요약” 숫자들
    const pubCount = storeSummary?.totalStoreCount ?? 0;

    // 지금은 별점/리뷰가 없으니까 null/0
    const avgRating = null;
    const reviews = 0;

    const topPubs = kakaoPubs.map((p) => ({
      name: p.name,
      rating: null,
      reviewCount: 0,
    }));

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
      topPubs,
      monthly: [], // 리뷰 DB 붙이면 여기 채우자
      traffic: trafficSummary,
      store: storeSummary,
      kakaoPubs,
      taChange,
      sales: salesSummary
        ? {
            period: salesSummary.period,
            totalAmt: salesSummary.totalAmt,
            weekendRatio: salesSummary.weekendRatio,
            peakTimeSlot: salesSummary.peakTimeSlot,
          }
        : null,
      facility,
    };
  }
  // src/modules/report/report.service.ts 안에서

  async generateReportText(report: ReportResponse): Promise<string> {
    const reportJson = JSON.stringify(report, null, 2);

    const completion = await this.openai.chat.completions.create({
      model: this.modelName,
      messages: [
        {
          role: "system",
          content: `
너는 서울 각 행정동의 상권 데이터를 해석해서
술집/요식업 1인 창업자를 위한 분석 리포트를 써주는 컨설턴트야.

반드시 다음 규칙을 지켜라:

1) **출력 형식**
- 반드시 한국어로 작성한다.
- 마크다운(Markdown) 형식을 사용한다.
- 제목과 섹션은 #, ##, ### 를 사용한다.
- 목록은 - 또는 1. 2. 형식으로 사용한다.

2) **데이터 사용 원칙**
- 아래 JSON 안에 있는 숫자/사실만 기반으로 분석한다.
- JSON에 없는 구체적인 숫자(예: 매출액, 임대료 수준, 정확한 인구 수 등)는 지어내지 않는다.
- JSON에 없는 항목은 "데이터 기준으로는 ○○ 정보가 부족합니다." 라고 분명히 밝힌다.
- 숫자를 말할 때는 가능한 한 JSON의 필드를 참고해서 "대략적인 경향"을 서술한다.

3) **JSON 필드 설명**
- report.dong: { name, code } => 행정동 이름과 코드
- report.summary:
  - pubCount: 술집/유관 업종 점포 수
  - avgRating, reviews: (지금은 거의 사용 안 됨, null일 수 있음)
- report.traffic (없을 수도 있음):
  - totalFootfall: 해당 기간 유동 인구 총합
  - maleRatio, femaleRatio: 성비 비율 (0~1)
  - age20_30Ratio: 20~30대 비율 (0~1)
  - peakTimeSlot: 유동 인구가 가장 많은 시간대 (예: "17-21")
- report.store (없을 수도 있음):
  - totalStoreCount: 술집 관련 점포 수
  - openRate, closeRate: 창·폐업 비율 (0~1)
  - franchiseRatio: 프랜차이즈 비중 (0~1)
- report.kakaoPubs: 카카오 장소 검색으로 가져온 실제 술집 후보 (name, category, url)

4) **레포트 구성 예시**
아래 섹션 구조를 기본 골격으로 사용해라. 필요하면 약간 변형해도 되지만, 전반적인 흐름은 유지한다.

# {행정동 이름} 술집 상권 리포트

## 1. 상권 개요
- 이 동네의 술집 수, 유동 인구 규모, 대략적인 분위기 요약
- 유동 인구와 점포 수를 함께 언급해서 "상대적으로 붐비는 편인지" 해석

## 2. 유동 인구 & 타깃 고객 분석
- 성비(maleRatio, femaleRatio)
- 20~30대 비중(age20_30Ratio)
- 가장 붐비는 시간대(peakTimeSlot)
- 야간 중심인지, 주간 생활권인지 등 "느낌"을 설명
- traffic 데이터가 없으면 데이터 부족을 명시

## 3. 술집·경쟁 상황
- totalStoreCount, openRate, closeRate, franchiseRatio를 활용해서
  - 경쟁 점포 수
  - 폐업 비율이 높은지/낮은지
  - 프랜차이즈 비중이 높은지/개인 점포 위주인지
- store 데이터가 없으면, "점포 데이터 부족"을 언급하고 추측은 하지 말 것

## 4. 실제 술집 예시
- kakaoPubs 리스트를 최대 5개 정도 bullet로 나열
  - 가게 이름, 카테고리, URL을 간단히 보여주고
  - 이 동네에서 어떤 스타일 가게가 이미 자리 잡고 있는지 설명
- kakaoPubs가 비어 있으면 "카카오 장소 검색 결과가 부족"하다고 언급

## 5. 종합 인사이트 요약
- 위의 내용을 기반으로, 이 동네 술집 상권의 장점/리스크를 짧게 정리
- 창업자가 이 동네를 고려할 때 핵심적으로 봐야 할 포인트 3~5개를 bullet로 정리

5) **톤**
- 너무 가볍지 않게, 실제 컨설팅 리포트처럼 진지하지만 친절한 톤으로 작성한다.
- "~일 수 있습니다." / "~로 보입니다." 처럼 가설형 표현을 사용해라.
        `.trim(),
        },
        {
          role: "user",
          content: `
다음은 특정 행정동의 상권 데이터(JSON)야.
이 데이터를 기반으로 상권 분석 리포트를 작성해줘.

JSON 데이터:
${reportJson}
        `.trim(),
        },
      ],
    });

    return completion.choices[0]?.message?.content?.trim() ?? "";
  }

  // src/modules/report/report.service.ts 안에서

  async generateAdvice(
    report: ReportResponse,
    options: AdviceOptions,
    question: string
  ): Promise<string> {
    const reportJson = JSON.stringify(report, null, 2);
    const optionsJson = JSON.stringify(options, null, 2);
    const kakaoPubs = report.kakaoPubs ?? [];

    const kakaoListText =
      kakaoPubs.length > 0
        ? kakaoPubs
            .map((p, idx) => `${idx + 1}. ${p.name} (${p.category}) - ${p.url}`)
            .join("\n")
        : "해당 동네에서 카카오 API로 찾은 술집 정보가 충분하지 않습니다.";

    const safeQuestion =
      question && question.trim().length > 0
        ? question
        : "제가 이 동네에 1인 술집을 창업한다고 생각하고, 상권 특성과 제 조건을 고려한 현실적인 조언을 해주세요.";

    const completion = await this.openai.chat.completions.create({
      model: this.modelName,
      messages: [
        {
          role: "system",
          content: `
너는 서울 상권을 잘 아는 **술집/요식업 1인 창업 컨설턴트**야.

역할:
- 주어진 상권 데이터(JSON)과 창업자 조건(JSON)을 기반으로
- "내가 이 동네에 가게를 내면 어떤 포지셔닝과 전략이 좋을지"를 설명해주는 역할이다.

반드시 지킬 규칙:

1) **출력 형식**
- 한국어, 마크다운(Markdown).
- 제목은 ##, 소제목은 ### 를 사용해라.
- 문단 + bullet 조합으로 읽기 쉽게 작성해라.

2) **데이터 사용 원칙**
- 주어진 JSON(report, options) 안에 없는 구체 숫자는 만들지 않는다.
  - 예: 임대료 xx만원, 예상 매출 xx만원, 정확한 인구 수 등은 추측해서 작성하지 X.
- 대신 "상대적으로 많다/적다", "비율이 높은 편이다" 처럼 경향 위주로 설명한다.
- traffic, store, kakaoPubs 등이 null 이거나 비어 있으면
  - "데이터 기준으로는 ○○ 정보가 부족합니다." 를 먼저 말해주고
  - 그 뒤에 일반적인 업계 경험에 기반한 조언을 한다.

3) **JSON 필드 개념**
- report.dong: 행정동 이름/코드
- report.summary: 술집 수(pubCount) 등 요약
- report.traffic: 유동 인구 규모/구성 (없을 수 있음)
- report.store: 술집 점포 수, 프랜차이즈 비중, 폐업률 등 (없을 수 있음)
- report.kakaoPubs: 그 동네 실제 술집 예시 리스트

- options (창업자 조건):
  - budgetLevel: 예산 수준 (예: "low", "mid", "high" 또는 한국어로 들어올 수도 있음)
  - concept: 가게 컨셉 (예: "조용한 와인바", "스포츠 펍")
  - targetAge: 타깃 연령대 (예: "20대", "20-30대 직장인")
  - openHours: 운영 시간 (예: "퇴근 후~새벽", "저녁 6시~자정")

4) **답변 구성 가이드**
가능하면 아래 섹션 구조를 따라라:

## 1. 상권 요약 & 질문 재해석
- 이 동네 상권의 핵심 키워드를 2~3줄로 요약
- 사용자의 질문을 한 줄로 다시 정리 ("당신의 질문은 결국 ○○에 대한 고민입니다" 식으로)

## 2. 상권 vs 내 컨셉 적합도
- traffic / store / kakaoPubs 데이터를 기준으로
  - 현재 상권의 고객 흐름, 경쟁 강도, 기존 가게 스타일을 설명
- options.concept, options.targetAge 와 어떻게 맞는지 / 안 맞는지 분석

## 3. 입지 & 포지셔닝 전략
- 이 동에서 창업자가 어떤 포지션을 잡으면 좋을지
  - 예: 조용한 바 vs 시끄러운 펍, 가성비 vs 프리미엄, 술 위주 vs 안주 강한 집 등
- 예산 수준(budgetLevel)에 따라 인테리어/메뉴/규모를 어떻게 조정하면 좋을지

## 4. 운영 전략 (시간대, 메뉴, 마케팅)
- openHours, peakTimeSlot(traffic 기준)을 엮어서
  - 언제 집중 운영해야 할지
  - 어떤 시간대에 프로모션/이벤트를 하면 좋을지
- targetAge에 맞는 메뉴/가격대/마케팅 채널(인스타, 네이버 등) 제안

## 5. 리스크 & 체크리스트
- 이 상권에서 특히 조심해야 할 포인트 3~5개
- 창업자가 최종 결정을 내리기 전에 꼭 확인해야 할 체크리스트

## 6. 한 줄 총평
- 이 창업자에게 해주고 싶은 핵심 한 줄 조언

5) **톤**
- "현실적인데 따뜻한 선배 사장님" 느낌으로 조언해라.
- 지나치게 긍정적이거나 부정적이지 말고, 데이터와 조건을 기반으로 솔직하게 말해라.
        `.trim(),
        },
        {
          role: "user",
          content: `
[상권 데이터(JSON)]
${reportJson}

[창업자 조건(JSON)]
${optionsJson}

[주변 실제 술집 예시 (카카오 API 결과)]
${kakaoListText}

[창업자의 질문]
${safeQuestion}

위 정보를 기반으로 **"${report.dong.name}" 행정동** 상권 분석과 창업 조언을 아래 구조로 작성해줘.

1. 상권 요약 & 질문 재해석
2. 상권 vs 내 컨셉 적합도
3. 입지 & 포지셔닝 전략
4. 운영 전략 (시간대, 메뉴, 마케팅)
5. 리스크 & 체크리스트
6. 주변 실제 술집 이름, url
6. 한 줄 총평

가능하다면 위의 [주변 실제 술집 예시]도 참고해서
경쟁 구도, 포지셔닝, 리스크를 언급해줘.
        `.trim(),
        },
      ],
    });

    return completion.choices[0]?.message?.content?.trim() ?? "";
  }
}
