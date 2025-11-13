// src/modules/report/report.service.ts
import { Injectable, NotFoundException } from "@nestjs/common";
import OpenAI from "openai";
import { ConfigService } from "@nestjs/config";
import { DongService } from "../dong/dong.service";
import { TrafficService } from "../traffic/traffic.service";
import { StoreService } from "../store/store.service";
import { KakaoLocalService } from "../kakao/kakao-local.service";
import { TAChangeService } from "../ta_change/ta-change.service";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { DongQuarterSummary } from "../summary/entities/dong_quarter_summary";
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
    @InjectRepository(DongQuarterSummary)
    private readonly dongQuarterRepo: Repository<DongQuarterSummary>,
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

  private toNum(v: unknown): number {
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }

  /**
   * 동별 분기 타임라인 요약
   * - 술집 매출(총액, 주말 비중)
   * - 성별 매출 비중
   * - 20~30대 매출 비중
   * - 시간대별 매출 중 피크 타임
   * - 상권 변화 지표 (LL/LH/HL/HH)
   * - 주변 시설(집객 시설) 요약
   */
  async getDongQuarterSeries(dongCode: string) {
    // 1) 해당 동의 모든 분기 데이터 (과거 → 현재 순)
    const rows = await this.dongQuarterRepo.find({
      where: { dongCode },
      order: { period: "ASC" },
    });

    // 2) 가공해서 프론트/LLM이 바로 쓰기 좋은 형태로 변환
    return rows.map((r) => {
      const maleAmt = this.toNum(r.maleAmt);
      const femaleAmt = this.toNum(r.femaleAmt);
      const genderTotal = maleAmt + femaleAmt;

      const age10 = this.toNum(r.age10Amt);
      const age20 = this.toNum(r.age20Amt);
      const age30 = this.toNum(r.age30Amt);
      const age40 = this.toNum(r.age40Amt);
      const age50 = this.toNum(r.age50Amt);
      const age60 = this.toNum(r.age60PlusAmt);
      const ageTotal = age10 + age20 + age30 + age40 + age50 + age60;

      const slots = [
        { key: "00-06", v: this.toNum(r.tm00_06Amt) },
        { key: "06-11", v: this.toNum(r.tm06_11Amt) },
        { key: "11-14", v: this.toNum(r.tm11_14Amt) },
        { key: "14-17", v: this.toNum(r.tm14_17Amt) },
        { key: "17-21", v: this.toNum(r.tm17_21Amt) },
        { key: "21-24", v: this.toNum(r.tm21_24Amt) },
      ];

      // 피크 타임대 찾기
      let peakTimeSlot: string | null = null;
      let maxSlotVal = -1;
      for (const s of slots) {
        if (s.v > maxSlotVal) {
          maxSlotVal = s.v;
          peakTimeSlot = s.key;
        }
      }

      return {
        period: r.period,

        // 매출 추세
        alcoholTotalAmt: this.toNum(r.alcoholTotalAmt),
        alcoholWeekendRatio: r.alcoholWeekendRatio ?? 0,

        // 상권 변화 지표
        changeIndex: r.changeIndex as "LL" | "LH" | "HL" | "HH" | null, // 'LL' | 'LH' | 'HL' | 'HH' | null
        changeIndexName: r.changeIndexName, // '다이나믹' 등

        // 성별 비중 (매출 기준)
        maleRatio: genderTotal > 0 ? maleAmt / genderTotal : null,
        femaleRatio: genderTotal > 0 ? femaleAmt / genderTotal : null,

        // 20~30대 비중 (매출 기준)
        age20_30Ratio: ageTotal > 0 ? (age20 + age30) / ageTotal : null,

        // 피크 매출 시간대
        peakTimeSlot,

        // 주변 시설 요약
        viatrFacilityCount: r.viatrFacilityCount ?? 0,
        universityCount: r.universityCount ?? 0,
        subwayStationCount: r.subwayStationCount ?? 0,
        busStopCount: r.busStopCount ?? 0,
        bankCount: r.bankCount ?? 0,
      };
    });
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
    const quarterSeries = await this.getDongQuarterSeries(dong.code);

    // 2) 트래픽 + 점포 + 카카오 한 번에 병렬 호출
    const [
      metric,
      storeSummary,
      kakaoPlaces,
      taMetric,
      salesSummary,
      facility,
    ] = await Promise.all([
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
      salesTrend: quarterSeries,
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

입력으로 특정 행정동에 대한 JSON 데이터를 받게 된다.
이 JSON에는 다음 정보들이 포함되어 있다.

- dong: { id, name, code }  → 행정동 기본 정보
- summary: 술집 수(pubCount), 평균 평점, 리뷰 수 등
- traffic: 최근 분기의 유동 인구 요약
  - totalFootfall: 전체 유동 인구 규모
  - maleRatio, femaleRatio: 성비 비율
  - age20_30Ratio: 20~30대 비율
  - peakTimeSlot: 가장 붐비는 시간대 (예: "17-21")
- store: 술집 점포 현황
  - totalStoreCount: 점포 수
  - openRate, closeRate: 창업·폐업 비율
  - franchiseRatio: 프랜차이즈 비중
- kakaoPubs: 실제 카카오 지도에 등록된 술집 목록 (이 동네의 가게 스타일 예시)
- taChange: 상권 변화 지표(최신 분기)
  - index (LL/LH/HL/HH), indexName(다이나믹, 확장 등),
  - opRunMonthAvg, clRunMonthAvg, seoulOpRunMonthAvg, seoulClRunMonthAvg
  - index 해석:
    - 지표의 첫 글자(L/H)는 "개업(창업) 수준"을, 두 번째 글자(L/H)는 "폐업 수준"을 의미한다.
    - LL: 개업도 낮고 폐업도 낮은, 비교적 안정적인 상권
    - LH: 개업은 낮고 폐업은 높은, 축소·쇠퇴 위험이 있는 상권
    - HL: 개업은 높고 폐업은 낮은, 확장·성장 중인 상권
    - HH: 개업과 폐업이 모두 활발한, 매우 다이나믹하고 교체가 잦은 상권
- facility: 주변 집객 시설 데이터(최신 분기)
  - viatrFacilityCount: 집객시설 총 개수
  - universityCount: 대학교 수
  - subwayStationCount: 지하철역 수
  - busStopCount: 버스 정류장 수
  - bankCount: 은행 수
- sales: 최신 분기 술집 매출 요약
  - totalAmt: 술집 관련 업종 합산 매출액
  - weekendRatio: 주말 매출 비중
  - peakTimeSlot: 매출 피크 시간대
- salesTrend: 과거 여러 분기에 걸친 술집 시장 추이 배열
  - 각 원소는 { period, alcoholTotalAmt, alcoholWeekendRatio,
    changeIndex, changeIndexName, maleRatio, femaleRatio,
    age20_30Ratio, peakTimeSlot, viatrFacilityCount, ... } 형태다.
  - 이 배열을 통해 “매출 추세”, “고객 구성 변화”, “상권 변화 패턴”을 분석할 수 있다.

규칙:
- 반드시 입력 JSON 안의 수치/정보만 사용하고,
  없는 정보는 추측하지 말고 "데이터가 없어 판단이 어렵습니다"라고 말해라.
- 숫자는 너무 세밀하게 말하지 말고, 소수점 1자리 또는
  "약 30%대"처럼 대략적인 표현을 사용해라.
- 사용자는 전문 데이터 분석가가 아니므로,
  통계 용어 남발하지 말고 일상어로 설명해라.
- 서울에서 술집을 준비 중인 예비 창업자를 대상으로 말하듯이,
  존댓말을 사용해라.

레포트 구성은 다음 기본 구조를 따른다:

# {행정동 이름} 술집 상권 리포트

## 1. 상권 한눈에 보기
- 술집 수, 유동 인구 규모, 집객 시설 존재 여부 등을 3~5줄로 요약
- "조용한 동네 vs 번화가", "직장인 중심 vs 거주지 중심" 느낌을 설명

## 2. 유동 인구 & 잠재 고객 분석
- 성비(maleRatio, femaleRatio),
- 20~30대 비중(age20_30Ratio),
- 유동 인구 피크 시간대(traffic.peakTimeSlot)를 설명
- 유동 인구 데이터가 없으면 "데이터 기준으로는 유동 인구 정보가 부족합니다"라고 명시

## 3. 술집 시장 & 경쟁 구도
- store.totalStoreCount, openRate, closeRate, franchiseRatio를 활용해서
  - 경쟁 점포 수,
  - 창·폐업 활발한지 여부,
  - 프랜차이즈/개인 비율을 해석
- store 정보가 없으면, 점포 관련 데이터가 부족함을 먼저 밝힌다.

## 4. 매출·상권 추세 (salesTrend 활용)
- salesTrend 배열을 시간 순서대로 훑으면서
  - 술집 매출(alcoholTotalAmt)이 늘어났는지/줄었는지
  - 주말 비중(alcoholWeekendRatio)이 어떻게 바뀌었는지
  - 상권 지표(changeIndex / changeIndexName)가 어떻게 변했는지
  - 피크 시간대(peakTimeSlot)가 바뀌었는지
- "코로나 이후 회복 추세", "최근 몇 분기 연속 감소", "상권 확장 → 다이나믹 변화" 등
  흐름을 사람 말로 쉽게 정리해준다.

## 5. 주변 시설과 술집 시너지
- facility 데이터를 활용해서
  - 대학교, 버스/지하철, 집객시설(관공서, 병원, 상가 등)이
    술집 상권에 어떤 영향을 줄 수 있는지 설명
- 값이 0이거나 null이면, 그에 맞춰 솔직하게 말해준다.

## 6. 실제 술집 예시
- kakaoPubs에서 가게 이름/카테고리를 몇 개 뽑아서
  - "이 동네에는 이런 스타일의 술집이 이미 있다"는 예시를 든다.
- kakaoPubs가 비어 있으면 결과 부족을 언급.

## 7. 종합 인사이트 & 추천 요약
- 위 내용을 기반으로 이 동네 술집 상권의
  - 장점 2~3개,
  - 리스크 2~3개를 bullet로 정리
- "이 동네에 술집을 낸다면 어떤 성격의 가게가 어울릴지" 한 문단으로 정리
      `.trim(),
        },
        {
          role: "user",
          content: `
다음은 특정 행정동의 상권 데이터(JSON)입니다.
이 데이터를 기반으로 위에서 설명한 구조에 따라
술집 상권 분석 리포트를 작성해주세요.

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
            .map((p, idx) =>
              `${idx + 1}. ${p.name} (${p.category}) - ${p.url ?? ""}`.trim()
            )
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
- "내가 이 동네에 가게를 내면 어떤 포지셔닝과 전략이 좋을지"를 설명하는 역할이다.

데이터 개요:
- report.dong: 행정동 정보
- report.traffic: 유동 인구 구조 (성별/연령/피크 시간대)
- report.store: 점포 수, 창·폐업률, 프랜차이즈 비중
- report.sales: 최신 분기 술집 매출 요약
- report.salesTrend: 여러 분기에 걸친 술집 시장 추이
- report.taChange: 상권 변화 지표(LL/LH/HL/HH 등)
  - LL/LH/HL/HH 코드를 활용해서 이 상권이
    안정적인지, 성장 중인지, 축소 중인지, 매우 다이나믹한지 해석해라.
- report.facility: 주변 집객 시설(대학교, 버스, 지하철 등)
- report.kakaoPubs: 주변 실제 술집 예시
- options: 창업자의 조건(예산, 컨셉, 타깃 연령, 운영 시간 등)

반드시 지킬 규칙:

1) 출력 형식
- 한국어, 마크다운(Markdown).
- 제목은 ##, 소제목은 ### 를 사용해라.
- 문단 + bullet 조합으로 읽기 쉽게 작성해라.

2) 데이터 사용 원칙
- 주어진 JSON(report, options) 안에 없는 **구체 숫자**는 만들지 않는다.
  - 예: 임대료 xx만원, 예상 매출 xx만원, 정확한 인구 수 등은 추측해서 작성하지 말 것.
- 대신 "상대적으로 많다/적다", "비율이 높은 편이다"처럼 **경향** 위주로 설명한다.
- traffic, store, kakaoPubs, salesTrend 등이 null 이거나 비어 있으면
  - "데이터 기준으로는 ○○ 정보가 부족합니다." 를 먼저 말해주고
  - 그 뒤에 일반적인 업계 경험을 바탕으로 조심스럽게 조언한다.

3) options(창업자 조건) 필드
- budgetLevel: 예산 수준 (예: "low", "mid", "high" 또는 한국어 표현)
- concept: 가게 컨셉 (예: "조용한 와인바", "스포츠 펍")
- targetAge: 타깃 연령대 (예: "20대", "20-30대 직장인")
- openHours: 운영 시간 (예: "퇴근 후~새벽", "저녁 6시~자정")

4) 답변 구성 구조

## 1. 상권 요약 & 질문 재해석
- report.dong.name 기준으로 동네를 한 줄로 요약
- 사용자의 질문을 "결국 어떤 고민인지" 한 줄로 다시 정리

## 2. 상권 vs 내 컨셉 적합도
- traffic(성비, 20~30대 비중, 피크 시간대),
- store(점포 수, 폐업률, 프랜차이즈 비중),
- salesTrend(매출 추세, 상권 변화 지표),
- facility(대학교/지하철/버스 등)을 참고해서
  - options.concept, options.targetAge와 잘 맞는지/어디가 어긋나는지 분석한다.

## 3. 입지 & 포지셔닝 전략
- 이 동네에서 창업자가 잡으면 좋을 포지션을 제안
  - 예: 조용한 와인바 vs 시끄러운 펍, 가성비 vs 프리미엄, 혼술용 vs 모임용 등
- budgetLevel을 고려해서
  - 인테리어/규모/메뉴 구성에 대한 현실적인 방향을 제안

## 4. 운영 전략 (시간대, 메뉴, 마케팅)
- openHours와 salesTrend/traffic의 peakTimeSlot을 비교해서
  - 어떤 시간대에 힘을 실어야 할지,
  - 언제 프로모션/이벤트를 하면 좋을지 제안
- targetAge에 맞는 메뉴/가격대/마케팅 채널(인스타, 네이버, 동네 커뮤니티 등)을 제안

## 5. 리스크 & 체크리스트
- 이 상권에서 특히 조심해야 할 포인트 3~5개를 bullet로 정리
- 창업자가 최종 결정을 내리기 전에 체크해야 할 항목을 bullet로 정리

## 6. 주변 실제 술집 예시
- kakaoPubs 리스트를 활용해서
  - 어떤 스타일의 가게들이 이미 있는지 3~5개 정도 언급
  - "경쟁이 강한 포지션"과 "비교적 비어 보이는 포지션"을 함께 설명

## 7. 한 줄 총평
- 이 창업자에게 해주고 싶은 핵심 한 줄 조언을 남긴다.

5) 톤
- "현실적인데 따뜻한 선배 사장님" 느낌으로 조언해라.
- 근거를 데이터에서 가져오되, 숫자보다 방향성을 강조해라.
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

위 정보를 기반으로 **"${report.dong.name}" 행정동**에 대한
창업 조언을 위에서 정의한 1~7번 구조에 맞춰 작성해줘.
        `.trim(),
        },
      ],
    });

    return completion.choices[0]?.message?.content?.trim() ?? "";
  }
}
