// src/modules/report/report.service.ts
import { Injectable, NotFoundException, Logger } from "@nestjs/common";
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
import { NaverBlogService } from "../naver-blog/naver-blog.service";
import { buildNaverQueryFromQuestion } from "../trend-docs/trend-query.util";
import {
  TrendDocsService,
  TrendDocSearchResult,
} from "../trend-docs/trend-docs.service";
import { classifyQuestion } from "./question-classifier";
import {
  ReportResponse,
  ReportMonthlyStat,
  AdviceResponse,
  AdviceOptions,
  SalesTrendItem,
  RiskInsight,
  RiskLevel,
} from "./report.types";
import { SalesService } from "../sale/sales.service";
import { FacilityService } from "../facility/facility.service";
import {
  KNOWN_TREND_AREAS,
  normalizeTrendArea,
} from "../../common/utils/area-normalizer";

@Injectable()
export class ReportService {
  private openai: OpenAI;
  private modelName: string;
  private readonly logger = new Logger(ReportService.name);

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
    private readonly trendDocsService: TrendDocsService,
    private readonly naverBlogService: NaverBlogService,
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

  // ReportService 안에 private 메서드로 추가

  private computeRisk(
    salesTrend: SalesTrendItem[],
    storeSummary: ReportResponse["store"] | null,
    taChange: ReportResponse["taChange"] | null
  ): RiskInsight | null {
    if (!salesTrend || salesTrend.length === 0) {
      return null;
    }

    // 최근 4개 분기만 사용 (데이터가 적으면 있는 만큼)
    const lastN = 4;
    const recent = salesTrend.slice(-lastN);
    const qoqList = recent
      .map((s) => (typeof s.qoqGrowth === "number" ? s.qoqGrowth : null))
      .filter((v): v is number => v !== null);

    let recentQoqAvg: number | null = null;
    let recentQoqVolatility: number | null = null;
    let negativeStreak = 0;

    if (qoqList.length > 0) {
      // 평균
      const sum = qoqList.reduce((acc, v) => acc + v, 0);
      recentQoqAvg = sum / qoqList.length;

      // 변동성(절댓값 평균)
      const volSum = qoqList.reduce((acc, v) => acc + Math.abs(v), 0);
      recentQoqVolatility = volSum / qoqList.length;
    }

    // 최신 분기 기준으로 연속 마이너스 카운트
    const reversed = [...salesTrend].reverse(); // 최신 → 과거
    for (const s of reversed) {
      if (typeof s.qoqGrowth !== "number") break;
      if (s.qoqGrowth < 0) negativeStreak++;
      else break;
    }

    const closeRate = storeSummary?.closeRate ?? null;
    const changeIndex = taChange?.index ?? null;

    // 기본 레벨 & 이유
    let level: RiskLevel = "medium";
    const reasons: string[] = [];

    // 🔴 High risk 조건
    if (negativeStreak >= 3) {
      level = "high";
      reasons.push("최근 3분기 이상 연속으로 매출이 감소하고 있습니다.");
    }
    if (recentQoqAvg !== null && recentQoqAvg < -0.3) {
      level = "high";
      reasons.push(
        "최근 분기 평균 매출 성장률이 -30% 이하로 크게 감소했습니다."
      );
    }
    if (closeRate !== null && closeRate >= 0.2) {
      level = "high";
      reasons.push("폐업 비율이 20% 이상으로 높게 나타납니다.");
    }

    // 🟢 Low risk 조건 (high로 이미 올라간 경우는 유지)
    if (level !== "high") {
      if (
        negativeStreak === 0 &&
        recentQoqAvg !== null &&
        recentQoqAvg >= 0 &&
        (closeRate === null || closeRate <= 0.05)
      ) {
        level = "low";
        reasons.push(
          "최근 분기 매출이 전반적으로 유지되거나 증가하는 편이고, 폐업 비율도 낮은 편입니다."
        );
      }
    }

    // changeIndex에 따른 코멘트(레벨은 크게 안 바꾸고 설명 위주)
    if (changeIndex === "LL") {
      reasons.push(
        "상권 변화 지표가 LL로, 전반적으로 활발한 확장보다는 방어적·변동적인 구간일 수 있습니다."
      );
    } else if (changeIndex === "LH" || changeIndex === "HL") {
      reasons.push(
        "상권 변화 지표가 LH/HL로, 일부 구간에서는 성장과 조정이 혼재된 상태일 수 있습니다."
      );
    } else if (changeIndex === "HH") {
      reasons.push(
        "상권 변화 지표가 HH로, 상대적으로 안정적인 확장 국면일 수 있습니다."
      );
    }

    if (reasons.length === 0) {
      reasons.push("특별히 높은 리스크 신호는 감지되지 않았습니다.");
    }

    return {
      level,
      reasons,
      metrics: {
        recentQoqAvg,
        recentQoqVolatility,
        negativeStreak,
        closeRate,
        changeIndex,
      },
    };
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

        prevAlcoholTotalAmt:
          r.prevAlcoholTotalAmt !== null && r.prevAlcoholTotalAmt !== undefined
            ? this.toNum(r.prevAlcoholTotalAmt)
            : null,
        qoqGrowth:
          r.qoqGrowth !== null && r.qoqGrowth !== undefined
            ? Number(r.qoqGrowth)
            : null,

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

    const risk = this.computeRisk(quarterSeries, storeSummary, taChange);

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
      risk,
    };
  }
  // src/modules/report/report.service.ts 안에

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
  - 각 원소는 대략 다음 형태다:
    {
      period,                  // 기준 년분기 (예: "20244")
      alcoholTotalAmt,         // 해당 분기 술집 매출 총액
      alcoholWeekendRatio,     // 주말 매출 비중
      changeIndex,             // 상권 변화 지표 코드 (LL/LH/HL/HH 등)
      changeIndexName,         // 상권 변화 지표 이름 (예: "다이나믹")
      maleRatio, femaleRatio,  // 성별 매출 비중
      age20_30Ratio,           // 20~30대 매출 비중
      peakTimeSlot,            // 매출 피크 시간대
      viatrFacilityCount,      // 집객 시설 수
      universityCount, subwayStationCount, busStopCount, bankCount,
      prevAlcoholTotalAmt,     // 직전 분기의 술집 매출 총액 (없으면 null)
      qoqGrowth                // 전 분기 대비 성장률: (이번-이전)/이전, 이전이 없으면 null
    }

- qoqGrowth 해석 가이드:
  - qoqGrowth > 0  이면 전 분기 대비 매출이 늘어난 것 (성장)
  - qoqGrowth < 0  이면 전 분기 대비 매출이 줄어든 것 (감소)
  - 같은 부호가 여러 분기 연속으로 이어지면
    - 연속 성장 추세 / 연속 하락 추세로 해석할 수 있다.
  - 값의 절대값이 클수록 변동성이 큰 상권일 수 있다.

- risk: 상권 리스크 요약 정보 (우리 서비스에서 미리 계산한 값)
  - level: "LOW" | "MID" | "HIGH" 중 하나 (리스크 수준)
  - score: 0~1 사이 숫자(선택적, 없을 수도 있음)
  - reasons: 문자열 배열로, 리스크를 그렇게 판단한 이유 목록
    (예: ["최근 3분기 연속 매출 감소", "폐업률이 높은 편"])

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
- salesTrend 배열을 시간 순서대로 훑으면서,
  - 술집 매출(alcoholTotalAmt)이 장기적으로 증가/감소/정체 중인지,
  - qoqGrowth를 보고 최근 몇 분기 연속 상승/하락 구간이 있는지,
  - 변동 폭이 큰 "롤러코스터형 상권"인지, 비교적 안정적인지,
  - 주말 비중(alcoholWeekendRatio)이 변하면서
    "주말 중심 → 평일/퇴근 후 중심" 등 패턴 변화가 있는지,
  - 상권 지표(changeIndex / changeIndexName)가
    LL/LH/HL/HH 사이에서 어떻게 이동했는지,
  - 피크 시간대(peakTimeSlot)가 과거와 비교해 바뀌었는지
- 예를 들어,
  - 코로나 시기 급락 후 최근 회복,
  - 몇 분기 연속 하락이라 보수적으로 볼 필요가 있음,
  - 매출은 정체지만 상권 지표는 확장 쪽으로 가는 중 등
  사람 말로 "흐름"을 정리해라.

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
  - report.risk가 있다면 반드시 활용해라.
  - report.risk.level 이 HIGH/MID/LOW 인지 한 줄로 먼저 말해주고,
  - report.risk.reasons 배열에 들어있는 문장들을
    - "● 최근 3분기 연속 매출이 감소하고 있습니다."
    - "● 폐업률이 서울 평균보다 높은 편입니다."
    처럼 다시 풀어서 써라.
  - 그리고 이 리스크를 줄이기 위해
    - "초기 임대료/인테리어 투자에 너무 공격적으로 가지 말 것"
    - "메뉴/컨셉을 자주 바꾸기보다는 1년 이상 일관되게 밀어볼 것"
    처럼 **“그래서 창업자가 어떻게 행동해야 하는지”**까지 연결해라.
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

    // 1) 질문을 DB vs RAG로 분류
    const route = classifyQuestion(safeQuestion);

    const adminDongName =
      report?.dong?.name || // ✅ 우리가 buildReport에서 넣어준 필드
      (report as any).emdName ||
      (report as any).dongName ||
      (report as any).areaName ||
      "";

    const trendAreaKeyword = normalizeTrendArea(adminDongName);

    const canUseTrend =
      !!trendAreaKeyword && KNOWN_TREND_AREAS.includes(trendAreaKeyword);

    // 2) 기본값 (RAG 안 쓰이거나, 검색 실패 시)
    let trendContextText = "트렌드 관련 참고 텍스트가 충분하지 않습니다.";
    let trendDocsSummary =
      "관련된 트렌드 참고 텍스트를 충분히 찾지 못했습니다.";

    console.log("---- Trend DEBUG ----");
    console.log("safeQuestion:", safeQuestion);
    console.log("adminDongName:", adminDongName);
    console.log("trendAreaKeyword:", trendAreaKeyword);
    console.log("route:", route);
    console.log("---------------------");

    // 3) 트렌드성 질문일 때만 RAG + 네이버 블로그 활용
    if (route === "RAG") {
      try {
        // (1) 네이버 블로그에서 최신 글 가져오기
        const naverQuery = buildNaverQueryFromQuestion(
          safeQuestion,
          trendAreaKeyword
        );
        console.log("[NAVER] query:", naverQuery);

        const blogResult = await this.naverBlogService.searchBlogs(naverQuery);

        console.log(
          "[NAVER] total:",
          blogResult.total,
          "items:",
          blogResult.items?.length ?? 0
        );
        if (blogResult.items?.length) {
          console.log(
            "[NAVER] first item sample:",
            blogResult.items[0].title,
            blogResult.items[0].link
          );
        }

        // 네이버 블로그 결과를 TrendDocs에 저장 (중복 방지)
        if (trendAreaKeyword && blogResult.items?.length) {
          await this.trendDocsService.saveFromNaverBlogs(
            trendAreaKeyword,
            blogResult.items
          );
        }

        // (2) RAG 벡터 검색
        const trendDocs = await this.trendDocsService.search(safeQuestion, 5);

        console.log("[RAG] trendDocs count:", trendDocs.length);
        if (trendDocs.length > 0) {
          console.log("[RAG] first doc:", {
            id: trendDocs[0].id,
            source: trendDocs[0].source,
            snippet: trendDocs[0].content.slice(0, 100),
          });
        }

        if (trendDocs && trendDocs.length > 0) {
          trendDocsSummary = trendDocs
            .slice(0, 3)
            .map(
              (d: TrendDocSearchResult, idx: number): string =>
                `(${idx + 1}) [source: ${d.source}] ${d.content}`
            )
            .join("\n");

          trendContextText = trendDocs
            .map(
              (d: TrendDocSearchResult, idx: number): string =>
                `#${idx + 1} [${d.source}]\n${d.content}`
            )
            .join("\n\n---\n\n");
        }
      } catch (e) {
        console.warn("RAG/네이버 트렌드 조회 중 오류:", e);
        trendContextText =
          "트렌드 검색 중 오류가 발생하여, 저장된 트렌드 텍스트를 활용하지 못했습니다.";
      }
    }
    const completion = await this.openai.chat.completions.create({
      model: this.modelName,
      messages: [
        {
          role: "system",
          content: `
        너는 서울 상권을 잘 아는 **술집/요식업 1인 창업 컨설턴트**야.
        
        역할:
        - 주어진 상권 데이터(JSON)과 창업자 조건(JSON), 그리고 창업자의 질문을 기반으로
        - "내가 이 동네에 가게를 내면 어떤 포지셔닝과 전략이 좋을지"를
          현실적으로, 그러나 따뜻하게 조언하는 역할이다.
        
        데이터 개요:
        - report.dong: 행정동 정보 (id, name, code)
        - report.traffic: 유동 인구 구조 (성별/연령/피크 시간대) 요약
        - report.store: 점포 수, 창·폐업률, 프랜차이즈 비중 등
        - report.sales: 최신 분기 술집 매출 요약
        - report.salesTrend: 여러 분기에 걸친 술집 시장 추이
          - 각 원소에는 alcoholTotalAmt(매출), alcoholWeekendRatio(주말 비중),
            changeIndex/changeIndexName(상권 변화 지표),
            prevAlcoholTotalAmt, qoqGrowth(전 분기 대비 성장률) 등이 들어있다.
          - qoqGrowth > 0 이면 전 분기보다 매출이 늘어난 것이고,
            qoqGrowth < 0 이면 전 분기보다 매출이 줄어든 것이다.
          - 같은 부호가 여러 분기 연속이면, 연속 성장/연속 하락 구간으로 볼 수 있다.
          - qoqGrowth의 절대값이 클수록 변동성이 큰 상권일 가능성이 있다.
        - report.taChange: 상권 변화 지표(LL/LH/HL/HH 등)와 지표 이름
        - report.facility: 주변 집객 시설(대학교, 버스, 지하철, 은행 등)
        - report.kakaoPubs: 주변 실제 술집 예시(이름, 카테고리, URL)
        - report.risk: 상권 리스크 요약 정보 (서비스에서 미리 계산한 값)
          - level: "LOW" | "MID" | "HIGH" 중 하나 (리스크 수준)
          - score: 0~1 사이 숫자일 수 있음
          - reasons: ["최근 3분기 연속 매출 감소", "폐업률이 높은 편"] 같은 리스크 근거 리스트
        - options: 창업자의 조건(예산, 컨셉, 타깃 연령, 운영 시간 등)
          - budgetLevel: 예산 수준 (예: "소규모", "중간", "고급" 등)
          - concept: 가게 컨셉 (예: "조용한 와인바", "스포츠 펍")
          - targetAge: 타깃 연령대 (예: "20대", "20~30대 직장인")
          - openHours: 운영 시간 (예: "퇴근 후~새벽", "저녁 6시~자정")
        - [창업자의 질문] 텍스트: 창업자가 직접 적은 고민/질문
        
        반드시 지킬 규칙:
        
        1) 출력 형식
        - 한국어, 마크다운(Markdown).
        - 제목은 ##, 소제목은 ### 를 사용해라.
        - 문단 + bullet 조합으로 읽기 쉽게 작성해라.
        - 섹션 구조는 아래 1~7번을 그대로 따른다.
        
        2) 데이터 사용 원칙
        - 주어진 JSON(report, options) 안에 없는 **구체 숫자**는 만들지 않는다.
          - 예: 임대료 xx만원, 예상 매출 xx만원, 정확한 인구 수 등은 추측해서 작성하지 말 것.
        - 대신 "상대적으로 많다/적다", "비율이 높은 편이다"처럼 **경향** 위주로 설명한다.
        - traffic, store, kakaoPubs, salesTrend, facility, risk 등이 null 이거나 비어 있으면
          - "데이터 기준으로는 ○○ 정보가 부족합니다." 를 먼저 말해주고
          - 그 뒤에 일반적인 업계 경험을 바탕으로 조심스럽게 조언한다.
        
        3) 질문 반영 원칙
        - [창업자의 질문]은 반드시 1번 섹션에서 **한두 문장으로 다시 정리**해서 보여줘라.
          - 예: "결국, 이 동네에서 와인바를 냈을 때 경쟁과 수익성이 괜찮을지 고민하고 계십니다."
        - 이후 각 섹션(2~5번)에서 **질문과 직접 연결된 코멘트**를 최소 1줄 이상 포함해라.
          - 예: "질문 주신 '30대 직장인 손님을 많이 끌 수 있을지'에 대해서는,
            유동 인구 구조를 보면 30대 비중이 높은 편이라 타깃과 잘 맞는 편입니다." 처럼.
        
        4) risk 활용 원칙
        - report.risk가 있을 때:
          - 2번(상권 vs 내 컨셉)과 5번(리스크 & 체크리스트)에서
            risk.level(LOW/MID/HIGH)과 risk.reasons를 인용해서 설명한다.
          - level이 HIGH면, 조언의 톤을 조금 더 **보수적/신중하게** 가져간다.
          - level이 LOW면, "리스크는 비교적 낮은 편이지만 그래도 체크해야 할 점" 위주로 정리한다.
        
        5) 답변 구성 구조
        
        ## 1. 상권 요약 & 질문 재해석
        - report.dong.name 기준으로 동네를 한 줄로 요약
        - [창업자의 질문]을 "결국 어떤 고민인지" 한두 문장으로 다시 정리
        
        ## 2. 상권 vs 내 컨셉 적합도
        - traffic(성비, 20~30대 비중, 피크 시간대),
        - store(점포 수, 폐업률, 프랜차이즈 비중),
        - salesTrend(매출 추세, qoqGrowth, 상권 변화 지표),
        - facility(대학교/지하철/버스 등), report.risk(level, reasons)를 참고해서
          - options.concept, options.targetAge와 잘 맞는지/어디가 어긋나는지 분석한다.
          - 질문 내용과 연결해서 "질문하신 부분은 데이터상으로 봤을 때 ○○한 편"이라고 설명해라.
        
        ## 3. 입지 & 포지셔닝 전략
        - 이 동네에서 창업자가 잡으면 좋을 포지션을 제안
          - 예: 조용한 와인바 vs 시끄러운 펍, 가성비 vs 프리미엄, 혼술용 vs 모임용 등
        - budgetLevel을 고려해서
          - 인테리어/규모/메뉴 구성에 대한 현실적인 방향을 제안
        - 질문 속 키워드(예: "혼술", "30대 직장인", "와인")가 있다면,
          그 키워드에 맞춘 포지셔닝 문장을 꼭 한 줄 이상 포함해라.
          또한, [트렌드 참고 텍스트]를 보면
"○○동 조용한 술집", "△△ 와인바" 같은 키워드가 많이 등장하는데,
이런 분위기와도 잘 어울리는 컨셉입니다.
        
        ## 4. 운영 전략 (시간대, 메뉴, 마케팅)
        - openHours와 salesTrend/traffic의 peakTimeSlot을 비교해서
          - 어떤 시간대에 힘을 실어야 할지,
          - 언제 프로모션/이벤트를 하면 좋을지 제안
        - targetAge에 맞는 메뉴/가격대/마케팅 채널(인스타, 네이버, 동네 커뮤니티 등)을 제안
        - 질문에서 언급한 고민(예: "손님이 많이 몰리는 시간대", "재방문을 늘리고 싶다")에 대한
          운영/마케팅 측면 해결책을 구체적으로 적어라.
        
        ## 5. 리스크 & 체크리스트
        - report.risk가 있다면 반드시 활용해라.
  - report.risk.level 이 HIGH/MID/LOW 인지 한 줄로 먼저 말해주고,
  - report.risk.reasons 배열에 들어있는 문장들을
    - "● 최근 3분기 연속 매출이 감소하고 있습니다."
    - "● 폐업률이 서울 평균보다 높은 편입니다."
    처럼 다시 풀어서 써라.
  - 그리고 이 리스크를 줄이기 위해
    - "초기 임대료/인테리어 투자에 너무 공격적으로 가지 말 것"
    - "메뉴/컨셉을 자주 바꾸기보다는 1년 이상 일관되게 밀어볼 것"
    처럼 **“그래서 창업자가 어떻게 행동해야 하는지”**까지 연결해라.
        
        ## 6. 주변 실제 술집 예시
        - kakaoPubs 리스트를 활용해서
          - 어떤 스타일의 가게들이 이미 있는지 3~5개 정도 언급
          - "경쟁이 강한 포지션"과 "비교적 비어 보이는 포지션"을 함께 설명
        - 질문(예: "와인바가 이미 많은지")과 연결해서,
          - "현재 와인바는 ○○ 정도이며, ○○ 포지션은 아직 여지가 있어 보입니다."처럼 말해라.
        
        ## 7. 한 줄 총평
        - 이 창업자에게 해주고 싶은 핵심 한 줄 조언을 남긴다.
        - 되도록 [창업자의 질문]을 다시 한번 언급하면서 마무리해라.

        [트렌드 텍스트 활용 규칙]

        - 아래에 제공되는 [트렌드 참고 텍스트 요약]과 [트렌드 참고 텍스트 전문]은
          네이버 블로그 등 온라인에서 추출한 최신 상권/가게 트렌드이다.
        - 이 텍스트를 단순 참고용이 아니라, 답변에 **반드시 최소 한 번 이상** 반영해야 한다.
        - 적어도 한 섹션(2, 3 또는 4번)에서
          "최근 블로그/온라인 트렌드를 보면 ○○ 같은 키워드가 자주 등장합니다." 처럼
          트렌드 텍스트에서 읽힌 패턴을 1~3줄 요약해서 언급해라.
        - 동네 이름이 질문 동(예: 합정동, 연남동)과 다르더라도,
          비슷한 상권(홍대입구, 연남동 등) 트렌드는 "유사 상권 사례"로 설명해도 된다.

        7) 톤
        - "현실적인데 따뜻한 선배 사장님" 느낌으로 조언해라.
        - 근거를 데이터에서 가져오되, 숫자보다 방향성과 실행 가능한 액션을 강조해라.
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

  [트렌드 참고 텍스트 (벡터 검색 결과 상위 몇 개 요약)]
${trendDocsSummary}

[트렌드 참고 텍스트 (원문에 가까운 형태)]
${trendContextText}
  
  [창업자의 질문]
  ${safeQuestion}

  [동 정보]
행정동(사용자가 선택한 동): ${adminDongName}
트렌드 검색용 상권 키워드: ${trendAreaKeyword || "매핑되지 않음"}

  
  위 정보를 기반으로 **"${report.dong.name}" 행정동**에 대한
  창업 조언을 위에서 정의한 1~7번 구조에 맞춰 작성해줘.
          `.trim(),
        },
      ],
    });

    return completion.choices[0]?.message?.content?.trim() ?? "";
  }
}
