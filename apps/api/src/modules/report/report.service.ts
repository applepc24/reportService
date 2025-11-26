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
import { perfTimer } from "../../common/utils/perTimer";
import { toSlimReport } from "./slim-report.util";
import { RentInfoService } from "../rent-info/rent-info.service";
import {
  isPerfFakeExternal,
  isPerfFakeLLM,
  fakeLLMResponse,
} from "../../common/utils/perf.util";
import {
  buildNaverQueryFromQuestion,
  buildNaverQueryWithLLM,
} from "../trend-docs/trend-query.util";
import { TrendDocsService } from "../trend-docs/trend-docs.service";
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
import { Inject } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";

type SearchTrendsArgs = {
  query: string;
  areaHint?: string;
  topK?: number;
};

@Injectable()
export class ReportService {
  private openai: OpenAI;
  private modelName: string;
  private readonly logger = new Logger(ReportService.name);
  private readonly RAG_CACHE_TTL_SEC = 60 * 60 * 24;
  private readonly adviceTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "search_trends",
        description:
          "상권 관련 트렌드 텍스트(네이버 블로그 RAG 등)를 검색해서 조언에 참고할 자료를 가져온다.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "사장님의 질문이나 상권 키워드를 포함한 자연어 검색 질의",
            },
            areaHint: {
              type: "string",
              description:
                "상권/동 이름 (예: '방배동', '성수동'). 없으면 빈 문자열.",
            },
            topK: {
              type: "integer",
              description: "최종 상위 몇 개까지 가져올지 (기본 5개)",
              default: 5,
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_rent_info",
        description:
          "상권(동/가/동네)의 매매 실거래가 요약을 조회한다. budgetLevel(소규모/중간/고급)을 함께 받아 조언에 반영할 수 있게 한다.",
        parameters: {
          type: "object",
          properties: {
            dongName: {
              type: "string",
              description: '조회할 동/가 이름. 예: "신당동", "을지로", "서초동"',
            },
            budgetLevel: {
              type: "string",
              description:
                '창업자 자본규모. "소규모"(<=5천), "중간"(5천~1.5억), "고급"(>=1.5억) 중 하나',
              enum: ["소규모", "중간", "고급"],
            },
          },
          required: ["dongName", "budgetLevel"],
          additionalProperties: false,
        },
      },
    }
  ];

  constructor(
    @Inject("BULLMQ_REDIS")
    private readonly redis: IORedis,
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
    private readonly configService: ConfigService, // 나중에 ReviewService, RAGService도 여기로 추가
    private readonly rentInfoService: RentInfoService,
    @Inject("RAG_SAVE_QUEUE") private readonly ragSaveQueue: Queue
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
  private async handleAdviceToolCall(
    toolCall: any,
    trendAreaKeyword: string
  ): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam> {
    const fn = toolCall.function;

    if (fn.name === "search_trends") {
      let args: SearchTrendsArgs;
      try {
        args = JSON.parse(fn.arguments || "{}");
      } catch (e) {
        this.logger.error("search_trends args JSON parse error", e);
        args = { query: trendAreaKeyword, areaHint: trendAreaKeyword, topK: 5 };
      }

      const query = args.query || trendAreaKeyword;
      const areaHint = args.areaHint || trendAreaKeyword;
      const topK = args.topK ?? 5;

      const docs = await this.trendDocsService.searchHybrid(
        query,
        topK,
        20,
        areaHint
      );

      const payload = {
        docs,
        usedQuery: query,
        areaHint,
      };

      const toolMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(payload),
      };

      return toolMessage;
    } else if (fn.name === "get_rent_info") {
      // 🔹 임대/매매 정보 툴 호출 처리
      let args: { dongName?: string; budgetLevel?: string };
      try {
        args = JSON.parse(fn.arguments || "{}");
      } catch (e) {
        this.logger.error("get_rent_info args JSON parse error", e);
        args = {};
      }

      const dongName = (args.dongName || trendAreaKeyword || "").trim();
      const budgetLevel = (args.budgetLevel || "").trim();

      this.logger.log(
        `[AdviceAgent] 🔧 get_rent_info 호출: dong="${dongName}", budget="${budgetLevel}"`
      );

      // 아직 CSV 연동 전이니까, RentInfoService는 간단한 mock을 돌려주도록 구현해둔 상태라고 가정
      const rentSummary = await this.rentInfoService.getSummaryByDongName(
        dongName
      );

      this.logger.log(
        `[AdviceAgent] 🔧 get_rent_info 결과: hasData=${!!rentSummary}`
      );

      const payload = {
        dongName,
        budgetLevel,
        rent: rentSummary,
      };

      const toolMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(payload),
      };

      return toolMessage;
    }

    // 미지원 도구일 경우 안전하게 에러 payload
    const fallback: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({
        error: `Unknown tool: ${fn.name}`,
      }),
    };
    return fallback;
  }

  private async runAdviceWithTools(args: {
    systemPrompt: string;
    userPrompt: string;
    trendAreaKeyword: string;
  }): Promise<string> {
    const { systemPrompt, userPrompt, trendAreaKeyword } = args;

    // 1) 기본 메시지 (system + user)
    const baseMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ];

    // 2) 1차 호출: tool 사용 여부를 모델에 맡기기 (tool_choice: "auto")
    const first = await this.openai.chat.completions.create({
      model: this.modelName,
      messages: baseMessages,
      tools: this.adviceTools,
      tool_choice: "auto",
    });

    const firstChoice = first.choices[0];
    if (!firstChoice) {
      this.logger.error("runAdviceWithTools: no choice in first completion");
      return "";
    }

    const firstMsg = firstChoice.message as any;
    const toolCalls = firstMsg.tool_calls;

    // 2-1) 도구 호출이 없으면, 이 답변 그대로 사용
    if (!toolCalls || toolCalls.length === 0) {
      const content = firstMsg.content;
      if (typeof content === "string") return content.trim();
      // content가 array일 수도 있어서 방어적으로 처리
      if (Array.isArray(content)) {
        return content
          .map((c: any) => c.text ?? "")
          .join("\n")
          .trim();
      }
      return "";
    }

    // 3) 도구 호출이 있다면, 각 toolCall을 처리해서 tool 메시지 생성
    const toolMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      [];

    for (const tc of toolCalls) {
      try {
        const toolMsg = await this.handleAdviceToolCall(tc, trendAreaKeyword);
        toolMessages.push(toolMsg);
      } catch (e) {
        this.logger.error("runAdviceWithTools: handleAdviceToolCall error", e);
      }
    }

    // 4) 2차 호출: 기존 대화 + tool 응답들을 모두 전달해서 최종 답변 생성
    const second = await this.openai.chat.completions.create({
      model: this.modelName,
      messages: [
        ...baseMessages, // system + user
        firstMsg, // tool_calls를 포함한 assistant 메시지
        ...toolMessages, // role: "tool" 메시지들
      ],
    });

    const secondChoice = second.choices[0];
    if (!secondChoice) {
      this.logger.error("runAdviceWithTools: no choice in second completion");
      return "";
    }

    const secondMsg = secondChoice.message as any;
    const finalContent = secondMsg.content;

    if (typeof finalContent === "string") return finalContent.trim();
    if (Array.isArray(finalContent)) {
      return finalContent
        .map((c: any) => c.text ?? "")
        .join("\n")
        .trim();
    }
    return "";
  }

  // ReportService 클래스 안, handleAdviceToolCall 아래에 추가
  // 1) 리턴 타입부터 변경
  private async runAdviceCompletionWithTools(
    baseMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    trendAreaKeyword: string
  ): Promise<{ content: string; toolsUsed: string[] }> {
    // 어떤 툴을 썼는지 모아둘 배열
    const toolsUsed: string[] = [];

    // 1) 1차 호출: tools=adviceTools, tool_choice=auto
    const first = await this.openai.chat.completions.create({
      model: this.modelName,
      tools: this.adviceTools,
      tool_choice: "auto",
      messages: baseMessages,
    });

    const firstChoice = first.choices[0];
    if (!firstChoice) {
      this.logger.warn("[AdviceAgent] first completion returned no choice");
      return { content: "", toolsUsed };
    }

    const toolCalls = firstChoice.message.tool_calls;

    this.logger.log(
      `[AdviceAgent] first tool_calls: ${
        toolCalls
          ? JSON.stringify(
              toolCalls.map((tc: any) => ({
                id: tc.id,
                type: tc.type,
                name: tc.function?.name, // function tool일 때만 존재
              }))
            )
          : "none"
      }`
    );

    // toolCalls 안에서 툴 이름 빼서 toolsUsed에 저장
    if (toolCalls && toolCalls.length > 0) {
      for (const tc of toolCalls as any[]) {
        const fnName = tc.function?.name as string | undefined;
        if (fnName && !toolsUsed.includes(fnName)) {
          toolsUsed.push(fnName);
        }
      }
    }

    // 2) tool 호출이 없으면, 그냥 이 답변을 그대로 사용
    if (!toolCalls || toolCalls.length === 0) {
      this.logger.log("[AdviceAgent] no tool_calls, return first content");
      return {
        content: firstChoice.message.content?.trim() ?? "",
        toolsUsed,
      };
    }

    // 3) tool_calls 있으면, 우리가 직접 실행해서 tool 메시지들 생성
    const toolMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      [];

    for (const toolCall of toolCalls as any[]) {
      try {
        const toolMsg = await this.handleAdviceToolCall(
          toolCall,
          trendAreaKeyword
        );
        toolMessages.push(toolMsg);
      } catch (e) {
        this.logger.error(
          `[AdviceAgent] tool execution error: ${toolCall.type}/${toolCall.id}`,
          e as any
        );
        // 에러가 나도 나머지 tool은 계속 시도
      }
    }

    // 4) 2차 호출: tool 결과들을 포함해서 최종 답변 생성
    const second = await this.openai.chat.completions.create({
      model: this.modelName,
      tools: this.adviceTools,
      tool_choice: "none", // 더 이상 tool 호출 말고 최종 답만
      messages: [
        ...baseMessages, // system + user
        firstChoice.message, // 첫 번째 모델 메시지 (tool_calls 포함)
        ...toolMessages, // 우리가 실행한 tool 결과들
      ],
    });

    const secondChoice = second.choices[0];
    if (!secondChoice) {
      this.logger.warn("[AdviceAgent] second completion returned no choice");
      return {
        content: firstChoice.message.content?.trim() ?? "",
        toolsUsed,
      };
    }

    return {
      content: secondChoice.message.content?.trim() ?? "",
      toolsUsed,
    };
  }

  // GET /report?dongId=1 에서 쓸 핵심 함수
  async buildReport(dongId: number): Promise<ReportResponse> {
    const endTotal = perfTimer("buildReport TOTAL");

    const endDongFetch = perfTimer("buildReport: dong + quarterSeries");
    // 1) 동 정보 가져오기
    const dong = await this.dongService.findById(dongId);
    if (!dong) {
      throw new NotFoundException(`dong ${dongId} not found`);
    }

    const dongCode = dong.code;
    const dongName = dong.name;
    const quarterSeries = await this.getDongQuarterSeries(dong.code);
    endDongFetch();

    const endParallel = perfTimer(
      "buildReport: Promise.all (traffic/store/kakao/ta/sales/facility)"
    );
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
    endParallel();

    const endAssemble = perfTimer("buildReport: assemble response");
    // ... (기존 가공 로직 그대로)
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

    const kakaoPubs = kakaoPlaces.map((p) => ({
      name: p.placeName,
      category: p.categoryName,
      url: p.placeUrl,
    }));

    const pubCount = storeSummary?.totalStoreCount ?? 0;
    const avgRating = null;
    const reviews = 0;

    const topPubs = kakaoPubs.map((p) => ({
      name: p.name,
      rating: null,
      reviewCount: 0,
    }));

    const risk = this.computeRisk(quarterSeries, storeSummary, taChange);

    const result = {
      dong: { id: dong.id, name: dong.name, code: dong.code ?? null },
      summary: { pubCount, avgRating, reviews },
      topPubs,
      monthly: [],
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
    endAssemble();

    endTotal();
    return result;
  }

  private makeRagCacheKey(params: {
    dongId: number;
    concept: string;
    budgetLevel: string;
    targetAge: string;
    openHours: string;
  }) {
    const { dongId, concept, budgetLevel, targetAge, openHours } = params;

    // key는 최대한 deterministic 하게
    return [
      "rag",
      `dong:${dongId}`,
      `concept:${concept}`,
      `budget:${budgetLevel}`,
      `age:${targetAge}`,
      `hours:${openHours}`,
    ].join("|");
  }

  private makeNaverQueryCacheKey(ragKey: string) {
    // ragKey에서 파생
    return `naverQuery|${ragKey}`;
  }

  private async getCacheJson<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async setCacheJson<T>(key: string, value: T, ttlSec: number) {
    await this.redis.set(key, JSON.stringify(value), "EX", ttlSec);
  }
  // src/modules/report/report.service.ts 안에

  async generateReportText(report: ReportResponse): Promise<string> {
    if (isPerfFakeExternal() || isPerfFakeLLM()) {
      return fakeLLMResponse("report-text");
    }
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
    const dongId = report.dong.id;
    const openHours = options.openHours ?? "저녁 시간대 중심";

    const ragKey = this.makeRagCacheKey({
      dongId,
      concept: options.concept,
      budgetLevel: options.budgetLevel,
      targetAge: options.targetAge,
      openHours,
    });
    const endTotal = perfTimer("generateAdvice TOTAL");

    // 세부 타이머들은 try 안/밖 상관없이 “끝내는 함수”를 확보
    let endPre: (() => void) | null = null;
    let endSlim: (() => void) | null = null;
    let endFinalLLM: (() => void) | null = null;

    try {
      // --- 0) Fake 모드 분기 ---
      if (isPerfFakeExternal() || isPerfFakeLLM()) {
        // ✅ 세부 타이머도 찍고 싶으면 최소 전처리 타이머라도 열고 닫자
        endPre = perfTimer("generateAdvice: preprocess");
        // ... fake 모드에서도 대충 전처리 로직 흉내만 내도 되고
        endPre();

        return fakeLLMResponse("report-advice");
      }

      // --- 1) preprocess ---
      endPre = perfTimer("generateAdvice: preprocess");

      endSlim = perfTimer("generateAdvice: build slimReport");
      const slimReport = toSlimReport(report);
      endSlim();

      const slimReportJson = JSON.stringify(slimReport, null, 2);
      const optionsJson = JSON.stringify(options, null, 2);

      const kakaoPubs = report.kakaoPubs ?? [];
      const kakaoListText =
        kakaoPubs.length > 0
          ? kakaoPubs
              .map((p, i) =>
                `${i + 1}. ${p.name} (${p.category}) - ${p.url ?? ""}`.trim()
              )
              .join("\n")
          : "해당 동네에서 카카오 API로 찾은 술집 정보가 충분하지 않습니다.";

      const safeQuestion = question?.trim()
        ? question
        : "제가 이 동네에 1인 술집을 창업한다고 생각하고...";

      const adminDongName =
        report?.dong?.name ||
        (report as any).emdName ||
        (report as any).dongName ||
        "";

      const trendAreaKeyword = normalizeTrendArea(adminDongName);

      // RAG 기본값
      let trendContextText = "트렌드 관련 참고 텍스트가 충분하지 않습니다.";
      let trendDocsSummary =
        "관련된 트렌드 참고 텍스트를 충분히 찾지 못했습니다.";

      endPre();

      // --- 2) RAG 전용 try/catch ---
      try {
        const cached = await this.redis.get(ragKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          trendContextText = parsed.trendContextText ?? "";
          trendDocsSummary = parsed.trendDocsSummary ?? "";
          this.logger.log(`[CACHE HIT] ragKey=${ragKey}`);
        } else {
          this.logger.log(`[CACHE MISS] ragKey=${ragKey}`);

          const endQueryLLM = perfTimer("RAG: buildNaverQueryWithLLM");
          let naverQuery =
            (await buildNaverQueryWithLLM(
              this.openai,
              this.modelName,
              safeQuestion,
              trendAreaKeyword,
              this.logger
            )) || "";
          endQueryLLM();

          const endQueryFallback = perfTimer("RAG: fallback");
          if (!naverQuery) {
            naverQuery = buildNaverQueryFromQuestion(
              safeQuestion,
              trendAreaKeyword
            );
          }
          endQueryFallback();

          const endNaver = perfTimer("RAG: naver searchBlogs");
          const blogResult = await this.naverBlogService.searchBlogs(
            naverQuery
          );
          endNaver();

          const endSave = perfTimer("RAG: saveFromNaverBlogs");
          if (trendAreaKeyword && blogResult.items?.length) {
            this.ragSaveQueue.add("save-trend-docs", {
              trendAreaKeyword,
              items: blogResult.items,
            });
          }
          endSave();

          const endHybrid = perfTimer("RAG: searchHybrid");
          const trendDocs = await this.trendDocsService.searchHybrid(
            safeQuestion,
            5,
            20,
            trendAreaKeyword
          );
          endHybrid();

          if (trendDocs?.length) {
            trendDocsSummary = trendDocs
              .slice(0, 3)
              .map((d, i) => `(${i + 1}) [source: ${d.source}] ${d.content}`)
              .join("\n");

            trendContextText = trendDocs
              .map((d, i) => `#${i + 1} [${d.source}]\n${d.content}`)
              .join("\n\n---\n\n");
          }
          await this.redis.set(
            ragKey,
            JSON.stringify({ trendContextText, trendDocsSummary }),
            "EX",
            60 * 30
          );
        }
      } catch (e) {
        console.warn("RAG 오류 → DB 데이터 위주로 조언합니다:", e);
        trendContextText =
          "트렌드 검색 중 오류가 발생하여, 저장된 트렌드 텍스트를 활용하지 못했습니다.";
      }

      // --- 3) 최종 LLM (tool-calling 엔진 사용) ---
      endFinalLLM = perfTimer("LLM: advice completion");
      const baseMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
        [
          {
            role: "system",
            content: `
            너는 Multi-Tool Agent 다. 항상 다음 구조로 사고하고 행동한다.

            Plan:
            1) 창업자 질문/조건(options)과 report를 요약한다.
            2) 반드시 search_trends 도구를 1회 이상 호출한다.
            3) 반드시 get_rent_info 도구를 1회 이상 호출한다. (dongName=report.dong.name 또는 유사명, budgetLevel=options.budgetLevel)
            4) 도구 결과를 반영해서 최종 조언을 작성한다.
            
            Tool:
            - tools 없이는 최종 답변을 완료하지 않는다. (반드시 2개 도구를 사용)
            
            Answer:
            - 아래 1~7 섹션 구조를 그대로 출력한다.
            
            
            ========================
            1) Plan 단계 (내부 계획)
            - 지금 사용자가 어떤 고민을 하고 있는지 한 줄로 정리한다.
            - 어떤 데이터(report, options)를 우선 참고할지 정한다.
            - 어떤 도구(search_trends, get_rent_info)를 호출할지, 또는 호출하지 않을지 결정한다.
            - 이 계획(Plan)은 사용자에게 그대로 출력하지 않는다. 너의 내부 사고 흐름이다.
              (중요) 하지만 최종 출력은 반드시 1~7 섹션 구조를 따라야 하므로,
              1번 섹션에는 “사용자에게 보여줘도 되는 수준의 짧은 계획(1~3줄)”만 적어라.
              체인오브쏘트처럼 길게 쓰지 마라.
            
            ========================
            2) Tool 단계
            - Plan 단계에서 필요하다고 판단되면 도구를 호출한다.
            - 사용할 수 있는 도구는 다음 두 가지다.
            
              - search_trends(query, areaHint, topK)
                - 네이버 블로그 기반 상권/업종 트렌드 텍스트를 가져온다.
            
              - get_rent_info(dongName, budgetLevel)
                - 특정 동(dongName)의 상업용 임대/매매 수준(평균/분포 등) 요약 정보를 가져온다.
                - budgetLevel(소규모/중간/고급)을 함께 참고해서,
                  "이 자본 규모로 이 동네에서 시작하는 것이 현실적으로 어느 정도 난이도인지" 판단할 때 사용한다.
            
            - 도구를 호출할 때는 반드시 tool_call 형식으로 호출한다.
            - 도구 응답을 받은 뒤, 그 내용을 요약해서 내부적으로 정리한다.
            - 도구 실패/빈값이어도 답변을 멈추지 말고, “데이터가 부족/실패”를 명시한 뒤 가능한 범위에서 조언을 진행한다.
              (단, 도구 호출 자체는 반드시 2개 모두 수행해야 한다.)
            
            ========================
            너는 서울 상권을 잘 아는 **술집/요식업 1인 창업 컨설턴트**야.
            
            역할:
            - 주어진 상권 데이터(JSON), 창업자 조건(JSON), 트렌드 텍스트, 그리고 창업자의 질문을 기반으로
              "내가 이 동네에 가게를 내면 어떤 포지셔닝과 전략이 좋을지"를
              현실적으로, 그러나 따뜻하게 조언하는 역할이다.
            
            ========================
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
            - report.risk: 상권 리스크 요약 정보 (미리 계산된 값)
              - level: "LOW" | "MID" | "HIGH"
              - score: 0~1 사이 숫자일 수 있음
              - reasons: ["최근 3분기 연속 매출 감소", "폐업률이 높은 편"] 같은 리스크 근거 리스트
            - options: 창업자의 조건(예산, 컨셉, 타깃 연령, 운영 시간 등)
              - budgetLevel: 예산 수준 (예: "소규모", "중간", "고급" 등)
              - concept: 가게 컨셉 (예: "조용한 와인바", "스포츠 펍")
              - targetAge: 타깃 연령대 (예: "20대", "20~30대 직장인")
              - openHours: 운영 시간 (예: "퇴근 후~새벽", "저녁 6시~자정")
              - [창업자의 질문]: 창업자가 직접 적은 고민/질문 텍스트
              - (추가로, 필요하면 search_trends, get_rent_info 도구를 호출해서
                 네이버 블로그 트렌드 및 임대 시세 정보를 조회할 수 있다.)
            - [창업자의 질문]: 창업자가 직접 적은 고민/질문 텍스트
            
            
            ========================
            반드시 지킬 규칙:
            
            1) 출력 형식
            - 한국어, 마크다운(Markdown).
            - 제목은 ##, 소제목은 ### 를 사용.
            - 문단 + bullet 조합으로 읽기 쉽게 작성.
            - 섹션 구조는 아래 1~7번을 그대로 따른다.
            
            2) 데이터 사용 원칙 (DB 데이터)
            - 주어진 JSON(report, options) 안에 없는 **구체 숫자**는 만들지 않는다.
              - 예: 임대료 xx만원, 예상 매출 xx만원, 정확한 인구 수 등은 추측해서 작성하지 말 것.
            - 대신 "상대적으로 많다/적다", "비율이 높은 편이다"처럼 **경향** 위주로 설명한다.
            - traffic, store, kakaoPubs, salesTrend, facility, risk 등이 null 이거나 비어 있으면
              - "데이터 기준으로는 ○○ 정보가 부족합니다."를 먼저 말해주고
              - 그 뒤에 일반적인 업계 경험을 바탕으로 조심스럽게 조언한다.
            
            3) 트렌드 텍스트 사용 원칙 (search_trends 도구)
            - 반드시 search_trends를 최소 1번 호출하고,
              결과에서 읽히는 “반복 키워드/니즈/요약 인사이트”를 2~4번 섹션 어딘가에 자연스럽게 녹여라.
            - 도구 텍스트를 그대로 복붙하지 말고, 패턴을 한국어 문장으로 해석해서 쓴다.
            - search_trends 결과가 거의 없거나 비어 있을 경우,
              "온라인 트렌드 데이터는 아직 부족하지만"이라고 반드시 언급하고,
              DB 데이터(report, options) 위주로 설명한다.
            
            3-1) 임대/자본 규모 & get_rent_info 사용 원칙
            - 반드시 get_rent_info를 최소 1번 호출하고,
              결과를 2~4번 섹션 어딘가에 자연스럽게 포함시켜라.
            - 이 정보는 특히 다음 판단에 필수:
              - options.budgetLevel(소규모/중간/고급)로 이 동네 진입 난이도가
                "비교적 여유/적당/꽤 빡빡" 중 어디에 가까운지.
            - 실제 금액을 과한 예측으로 확장하지 말고,
              “부담감/난이도” 중심으로 해석하라.
            
            4) 질문 반영 원칙
            - [창업자의 질문]은 반드시 1번 섹션에서 한두 문장으로 다시 정리해 보여준다.
            - 이후 2~5 섹션 각각에 “질문과 직접 연결된 코멘트”를 최소 1줄 이상 포함한다.
            
            5) risk 활용 원칙
            - report.risk가 있을 때:
              - 2번과 5번에서 risk.level(LOW/MID/HIGH)과 risk.reasons를 인용해 설명한다.
              - HIGH면 톤을 더 보수적으로, LOW면 “체크포인트” 중심으로.
            
            6) 동 이름(행정동 vs 법정동) 처리 규칙 (중요)
            - get_rent_info(dongName)의 dongName은 다음 순서로 시도한다.
              1) report.dong.name 그대로
              2) 공백/따옴표 제거 후 재시도
              3) “숫자+동”을 “동”으로 정규화 (예: 방배1동 → 방배동 / 서초2동 → 서초동)
            - 그래도 없으면 데이터 부족을 명확히 말하고, 임대 판단은 보수적으로 제안한다.
            
            
            ========================
            6) 답변 구성 구조 (1~7을 그대로 출력)
            
            ## 1. 상권 요약 & 질문 재해석
            - report.dong.name 기준으로 동네를 한 줄로 요약.
            - [창업자의 질문]을 "결국 어떤 고민인지" 한두 문장으로 다시 정리.
            - (짧은 계획 1~3줄) 어떤 데이터와 어떤 도구 결과를 묶어 판단할지 “짧게”만 적기.
            
            ## 2. 상권 vs 내 컨셉 적합도
            - traffic / store / salesTrend / facility / risk를 참고해서 컨셉/타깃 적합도 분석.
            - 질문과 직접 연결된 코멘트 최소 1줄 포함.
            - (자연스럽게) 여기 또는 3~4에 트렌드/임대 결과를 녹여도 됨.
            
            ## 3. 입지 & 포지셔닝 전략
            - 이 동네에서 잡으면 좋을 포지션 제안(조용/활기, 가성비/프리미엄, 혼술/모임).
            - budgetLevel을 고려한 현실적인 규모/인테리어/메뉴 방향.
            - (자연스럽게) search_trends의 키워드/니즈를 포지셔닝과 연결.
            
            ## 4. 운영 전략 (시간대, 메뉴, 마케팅)
            - openHours와 traffic 피크/매출 흐름 연결.
            - targetAge에 맞는 메뉴/마케팅 채널 제안.
            - (자연스럽게) 트렌드에서 읽힌 키워드를 운영 아이디어로 1~2개 연결.
            
            ## 5. 리스크 & 체크리스트
            - risk.level과 risk.reasons를 bullet로 풀어 쓰기.
            - 리스크를 줄이기 위한 “행동”까지 연결.
            
            ## 6. 주변 실제 술집 예시
            - kakaoPubs 3~5개 언급(있을 때만).
            - 경쟁이 강한 포지션 vs 비어 보이는 포지션을 같이 설명.
            - 질문과 연결된 코멘트 1줄 포함.
            
            ## 7. 한 줄 총평
            - 핵심 한 줄 조언 + 질문을 한번 더 언급하며 마무리.
            
            7) 톤
            - "현실적인데 따뜻한 선배 사장님" 느낌.
            - 숫자보다 방향성과 실행 가능한 액션 강조.
            - 단정하지 말고, 데이터 근거 범위 안에서 말하라.
            
            
            ========================
            [실행 순서 강제]
            - 반드시 다음 순서로 진행한다:
              1) search_trends(...) tool_call
              2) get_rent_info(...) tool_call
              3) 두 결과를 요약해 내부적으로 정리
              4) 1~7 섹션 답변 작성 (트렌드/임대 내용이 다른 데이터처럼 자연스럽게 섞이도록)
              [강제 포함 규칙]
              - 반드시 본문(2~4번 섹션) 어딘가에 아래 문장을 각각 1회 이상 포함해라.
                1) "최근 온라인 트렌드에서는 ..."
                2) "임대/매매 관점에서는 ..."
              - 문장 뒤 "..."에는 tool 결과를 해석한 내용이 1~2문장으로 이어져야 한다.
`.trim(),
          },
          {
            role: "user",
            content: `
        [상권 데이터(JSON) - slim]
        ${slimReportJson}
        
        [창업자 조건(JSON)]
        ${optionsJson}
        
        [주변 실제 술집 예시]
        ${kakaoListText}
        
        [창업자의 질문]
        ${safeQuestion}
        
        [동 정보]
        행정동: ${adminDongName}
        트렌드 키워드: ${trendAreaKeyword || "매핑되지 않음"}
        
        위 정보를 기반으로 **"${adminDongName}"**에 대한 조언을 작성해줘.
          `.trim(),
          },
        ];

      const { content, toolsUsed } = await this.runAdviceCompletionWithTools(
        baseMessages,
        trendAreaKeyword
      );

      endFinalLLM();

      return content;
    } finally {
      // ✅ 어떤 return/throw가 나도 TOTAL은 무조건 종료
      endTotal();
      if (endPre) endPre = null;
      if (endSlim) endSlim = null;
      if (endFinalLLM) endFinalLLM = null;
    }
  }
}
