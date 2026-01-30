// src/modules/report/report.service.ts
import { Injectable, NotFoundException, Logger, Inject } from "@nestjs/common";
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
import { validateAdviceOutput } from "./advice-output.schema";
import { createHash } from "crypto";
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
import { Queue } from "bullmq";
import IORedis from "ioredis";

type SearchTrendsArgs = {
  query: string;
  areaHint?: string;
  topK?: number;
};

type ToolState = {
  counts: Record<string, number>;
  memo: Record<string, any>;
};

type AdviceStageCb = (
  stage: string,
  meta?: Record<string, any>
) => void | Promise<void>;

type Citation = {
  source: string;
  url?: string;
  quote?: string;
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
              description:
                '조회할 동/가 이름. 예: "신당동", "을지로", "서초동"',
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
    },
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

  private makeTrendsToolCacheKey(params: {
    query: string;
    areaHint: string;
    topK: number;
  }) {
    const raw = `q=${params.query}|a=${params.areaHint}|k=${params.topK}`;
    const hash = createHash("sha1").update(raw).digest("hex");
    return `rag:trends:${hash}`;
  }

  private async fetchTrendsForTool(params: {
    query: string;
    areaHint: string;
    topK: number;
  }) {
    const { query, areaHint, topK } = params;

    const TTL = 60 * 30; // 30분
    const cacheKey = this.makeTrendsToolCacheKey({ query, areaHint, topK });

    // 1) 캐시
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        return { ...parsed, cacheHit: true, cacheKey };
      } catch {
        // 캐시가 깨졌으면 그냥 miss로 처리
      }
    }

    // 2) 네이버 쿼리 생성 (LLM → fallback)
    let naverQuery =
      (await buildNaverQueryWithLLM(
        this.openai,
        this.modelName,
        query, // ✅ safeQuestion 대신 "tool query"를 넣는다
        areaHint,
        this.logger
      )) || "";

    if (!naverQuery) {
      naverQuery = buildNaverQueryFromQuestion(query, areaHint);
    }

    // 3) 네이버 검색
    const blogResult = await this.naverBlogService.searchBlogs(naverQuery);

    // 4) 저장은 큐로 (비동기 적재)
    if (areaHint && blogResult.items?.length) {
      this.ragSaveQueue.add("save-trend-docs", {
        trendAreaKeyword: areaHint,
        items: blogResult.items,
      });
    }

    // 5) DB hybrid 검색 (임베딩 포함)
    const docs = await this.trendDocsService.searchHybrid(
      query,
      topK,
      20,
      areaHint
    );

    // 6) summary/contextText 만들어 캐시
    const trendDocsSummary = docs?.length
      ? docs
          .slice(0, 3)
          .map(
            (d: any, i: number) =>
              `(${i + 1}) [source: ${d.source}] ${d.content}`
          )
          .join("\n")
      : "";

    const trendContextText = docs?.length
      ? docs
          .map((d: any, i: number) => `#${i + 1} [${d.source}]\n${d.content}`)
          .join("\n\n---\n\n")
      : "";

    const payload = {
      docs,
      trendDocsSummary,
      trendContextText,
      naverQuery,
    };

    await this.redis.set(cacheKey, JSON.stringify(payload), "EX", TTL);

    return { ...payload, cacheHit: false, cacheKey };
  }

  private async handleAdviceToolCall(
    toolCall: any,
    trendAreaKeyword: string,
    toolState?: ToolState
  ): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam> {
    const fn = toolCall.function;
    const toolName: string = fn?.name ?? "unknown";

    const safeJsonParse = <T>(raw: any, fallback: T): T => {
      try {
        return JSON.parse(raw || "{}") as T;
      } catch (e) {
        this.logger.error(`${toolName} args JSON parse error`, e as any);
        return fallback;
      }
    };

    const okTool = (payload: any) => ({
      role: "tool" as const,
      tool_call_id: toolCall.id,
      content: JSON.stringify({ ok: true, tool: toolName, ...payload }),
    });

    const errTool = (error: any, extra?: any) => ({
      role: "tool" as const,
      tool_call_id: toolCall.id,
      content: JSON.stringify({
        ok: false,
        tool: toolName,
        error: error?.message ?? String(error),
        ...(extra ?? {}),
      }),
    });

    // 1) search_trends

    if (toolName === "search_trends") {
      const args = safeJsonParse<SearchTrendsArgs>(fn.arguments, {
        query: trendAreaKeyword,
        areaHint: trendAreaKeyword,
        topK: 5,
      });

      const query = (args.query || trendAreaKeyword || "").trim();
      const areaHint = (args.areaHint || trendAreaKeyword || "").trim();
      const topK = args.topK ?? 5;

      this.logger.log(
        `[AdviceAgent] 🔧 search_trends 호출: q="${query}", area="${areaHint}", topK=${topK}`
      );

      // ✅ 기능: "같은 (query+areaHint+topK)"로 이미 tool을 실행했다면,
      //         같은 run 안에서는 toolState.memo에서 바로 재사용(memo-hit)한다.
      // ✅ 이유: LLM이 같은 tool을 반복 호출해도 외부 호출/DB 호출을 줄여서 비용/지연을 줄임.
      const memoKey = this.makeTrendsToolCacheKey({ query, areaHint, topK });

      const memoHit = toolState?.memo?.[memoKey];
      if (memoHit) {
        this.logger.log(
          `[AdviceAgent] 🔧 search_trends memoHit=true docs=${
            memoHit.docs?.length ?? 0
          }`
        );
        return okTool({
          docs: memoHit.docs ?? [],
          usedQuery: query,
          areaHint,
          topK,
          cacheHit: true, // memo도 "캐시 히트"로 취급
          cacheKey: memoHit.cacheKey ?? memoKey,
          naverQuery: memoHit.naverQuery,
          trendDocsSummary: memoHit.trendDocsSummary,
          trendContextText: memoHit.trendContextText,
          memoHit: true,
          memoKey,
        });
      }

      try {
        // ✅ 기능: Redis 캐시(hit/miss) + 네이버 쿼리 생성 + 네이버 검색 + DB hybrid 검색까지 수행
        const out = await this.fetchTrendsForTool({ query, areaHint, topK });

        this.logger.log(
          `[AdviceAgent] 🔧 search_trends 결과: cacheHit=${out.cacheHit} docs=${
            out.docs?.length ?? 0
          } naverQuery="${out.naverQuery ?? ""}"`
        );

        // ✅ 기능: 이번 run에서 같은 요청이 다시 오면 재사용할 수 있도록 메모 저장
        if (toolState?.memo) {
          toolState.memo[memoKey] = out;
        }

        if (toolState?.memo) {
          const prevBest = toolState.memo.__search_trends_best;
          const prevLen = Array.isArray(prevBest?.docs)
            ? prevBest.docs.length
            : 0;
          const nextLen = Array.isArray(out?.docs) ? out.docs.length : 0;

          if (!prevBest || nextLen > prevLen) {
            toolState.memo.__search_trends_best = out;
          }
        }

        return okTool({
          docs: out.docs ?? [],
          usedQuery: query,
          areaHint,
          topK,
          cacheHit: out.cacheHit,
          cacheKey: out.cacheKey,
          naverQuery: out.naverQuery,
          trendDocsSummary: out.trendDocsSummary,
          trendContextText: out.trendContextText,
          memoHit: false,
          memoKey,
        });
      } catch (e) {
        // ✅ 기능: 절대 throw 하지 않고 tool 응답으로 에러를 반환해서
        //         OpenAI tool_call 루프가 중단되지 않게 한다.
        return errTool(e, {
          docs: [],
          usedQuery: query,
          areaHint,
          topK,
          memoKey,
        });
      }
    }

    // 2) get_rent_info
    if (toolName === "get_rent_info") {
      const args = safeJsonParse<{ dongName?: string; budgetLevel?: string }>(
        fn.arguments,
        {}
      );

      const dongName = (args.dongName || trendAreaKeyword || "").trim();
      const budgetLevel = (args.budgetLevel || "").trim();

      this.logger.log(
        `[AdviceAgent] 🔧 get_rent_info 호출: dong="${dongName}", budget="${budgetLevel}"`
      );

      try {
        const rentSummary = await this.rentInfoService.getSummaryByDongName(
          dongName
        );

        this.logger.log(
          `[AdviceAgent] 🔧 get_rent_info 결과: hasData=${!!rentSummary}`
        );

        return okTool({
          dongName,
          budgetLevel,
          rent: rentSummary,
        });
      } catch (e) {
        return errTool(e, {
          dongName,
          budgetLevel,
          rent: null,
        });
      }
    }

    // 3) unknown tool
    return errTool(new Error(`Unknown tool: ${toolName}`));
  }

  private trace(msg: string, meta?: any) {
    if (process.env.ADVICE_TRACE !== "1") return;
    const m = meta ? ` ${JSON.stringify(meta)}` : "";
    this.logger.log(`[AdviceTrace] ${msg}${m}`);
  }

  // ReportService 클래스 안, handleAdviceToolCall 아래에 추가
  // 1) 리턴 타입부터 변경
  private async runAdviceCompletionWithTools(
    baseMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    trendAreaKeyword: string,
    onDelta?: (text: string) => void | Promise<void>,
    onStage?: AdviceStageCb
  ): Promise<{
    content: string;
    toolsUsed: string[];
    toolMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  }> {
    const toolsUsed: string[] = [];

    const TOOL_LIMITS: Record<string, number> = {
      search_trends: 2,
      get_rent_info: 1,
    };

    const MAX_ROUNDS = 3;

    const toolState: ToolState = { counts: {}, memo: {} };

    const allToolMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      [];

    let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      ...baseMessages,
    ];

    this.trace("agent_start", {
      MAX_ROUNDS,
      TOOL_LIMITS,
      trendAreaKeyword,
      baseMessages: baseMessages.length,
    });

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      await onStage?.("tool_round", { round });

      this.trace("tool_round_start", {
        round,
        messageCount: messages.length,
        counts: toolState.counts,
      });

      const resp = await this.openai.chat.completions.create({
        model: this.modelName,
        tools: this.adviceTools,
        tool_choice: "auto",
        messages,
      });

      const choice = resp.choices?.[0];
      const assistantMsg = choice?.message;

      if (!assistantMsg) {
        this.trace("tool_round_no_assistant_msg", { round });
        return { content: "", toolsUsed, toolMessages: allToolMessages };
      }

      messages.push(assistantMsg);

      const toolCalls = assistantMsg.tool_calls ?? [];

      // toolsUsed 기록
      for (const tc of toolCalls as any[]) {
        const fnName = tc.function?.name as string | undefined;
        if (fnName && !toolsUsed.includes(fnName)) toolsUsed.push(fnName);
      }

      this.trace("tool_round_resp", {
        round,
        finishReason: choice?.finish_reason,
        toolCalls: (toolCalls as any[]).map((tc) => ({
          id: tc.id,
          name: tc.function?.name,
          argsLen: (tc.function?.arguments ?? "").length,
        })),
      });

      if (toolCalls.length === 0) {
        this.trace("tool_round_end_no_toolcalls", { round });
        break;
      }

      const toolMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
        [];

      for (const toolCall of toolCalls as any[]) {
        const toolName: string = toolCall?.function?.name ?? "unknown";

        const nextCount = (toolState.counts[toolName] ?? 0) + 1;
        toolState.counts[toolName] = nextCount;

        const max = TOOL_LIMITS[toolName] ?? 1;

        this.trace("tool_call_received", {
          round,
          toolName,
          callNo: nextCount,
          max,
        });

        // ✅ 상한 초과 처리: search_trends는 best가 있으면 best로 대체 응답
        if (nextCount > max) {
          if (toolName === "search_trends") {
            const best = toolState?.memo?.__search_trends_best;

            if (best && Array.isArray(best.docs) && best.docs.length > 0) {
              this.trace("tool_call_limit_exceeded_reuse_best", {
                toolName,
                callNo: nextCount,
                max,
                docs: best.docs.length,
                cacheKey: best.cacheKey ?? "(memo_best)",
              });

              toolMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                  ok: true,
                  tool: toolName,
                  docs: best.docs ?? [],
                  cacheHit: true,
                  memoHit: true,
                  reusedFrom: "__search_trends_best",
                  cacheKey: best.cacheKey ?? "(memo_best)",
                  naverQuery: best.naverQuery,
                  trendDocsSummary: best.trendDocsSummary,
                  trendContextText: best.trendContextText,
                  skipped: true,
                  reason: "tool_call_limit_exceeded_but_reused_best",
                  callNo: nextCount,
                  max,
                }),
              });
              continue;
            }
          }

          this.trace("tool_call_limit_exceeded_skip", {
            toolName,
            callNo: nextCount,
            max,
          });

          toolMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              ok: true,
              tool: toolName,
              skipped: true,
              reason: "tool_call_limit_exceeded",
              callNo: nextCount,
              max,
            }),
          });
          continue;
        }

        const toolMsg = await this.handleAdviceToolCall(
          toolCall,
          trendAreaKeyword,
          toolState
        );

        if (!toolMsg) {
          this.trace("tool_call_empty_response", { toolName });

          toolMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              ok: false,
              tool: toolName,
              error: "tool returned empty response",
            }),
          });
        } else {
          // ✅ tool 응답 요약 로그(너무 크면 위험 → 길이만)
          const c =
            typeof toolMsg.content === "string"
              ? toolMsg.content
              : JSON.stringify(toolMsg.content);
          this.trace("tool_call_done", {
            toolName,
            contentLen: c.length,
          });

          toolMessages.push(toolMsg);
        }
      }

      messages = [...messages, ...toolMessages];
      allToolMessages.push(...toolMessages);

      this.trace("tool_round_end", {
        round,
        addedTools: toolMessages.length,
        totalToolMsgs: allToolMessages.length,
      });
    }

    // ✅ 마지막: “최종 답변만” 스트리밍 (도구 금지)
    await onStage?.("final_stream");

    this.trace("final_stream_start", {
      messageCount: messages.length,
      toolsUsed,
    });

    const stream = await this.openai.chat.completions.create({
      model: this.modelName,
      tools: this.adviceTools,
      tool_choice: "none",
      stream: true,
      messages: [
        ...messages,
        {
          role: "system",
          content:
            "이제 도구 호출 없이, 위 근거를 반영해서 1~7 섹션 형식으로 최종 조언만 작성해라.",
        },
      ],
    });

    let full = "";
    let buf = "";
    let lastFlush = Date.now();
    const FLUSH_MS = 80;

    // ✅ 스트림 로그(스팸 방지): 1초에 1번 정도만 길이 찍기
    let lastStreamLogAt = 0;

    const flush = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastFlush < FLUSH_MS) return;
      if (!buf) return;
      const out = buf;
      buf = "";
      lastFlush = now;
      await onDelta?.(out);
    };

    for await (const chunk of stream as any) {
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        full += delta;
        buf += delta;
        await flush(false);

        if (process.env.ADVICE_TRACE === "1") {
          const now = Date.now();
          if (now - lastStreamLogAt > 1000) {
            lastStreamLogAt = now;
            this.logger.log(
              `[AdviceTrace] stream_progress len=${full.length} buf=${buf.length}`
            );
          }
        }
      }
    }
    await flush(true);

    this.trace("final_stream_end", { finalLen: full.trim().length });

    return { content: full.trim(), toolsUsed, toolMessages: allToolMessages };
  }

  private async finalizeAdviceMarkdown(params: {
    finalMarkdown: string;
    evidenceText: string; // toolEvidence든 server-agent evidence든
    citations: Citation[]; // 최소 1개 보장 목표
    onStage?: AdviceStageCb;
  }): Promise<string> {
    const extractJsonObject = (s: string) => {
      const start = s.indexOf("{");
      const end = s.lastIndexOf("}");
      if (start === -1 || end === -1 || end <= start) return null;
      return s.slice(start, end + 1);
    };

    const sanitizeMarkdown = (md: string) =>
      md.replace(/[\u3040-\u30ff]/g, "").replace(/~~/g, "");

    const citations =
      params.citations && params.citations.length > 0
        ? params.citations
        : [{ source: "internal_db" }];

    const draftObj = {
      version: "v1",
      title: "AI 상권 리포트",
      markdown: params.finalMarkdown.trim(),
      citations,
      warnings: [] as string[],
    };

    const v0 = validateAdviceOutput(draftObj);
    if (v0.ok) return v0.value.markdown.trim();

    await params.onStage?.("finalizing", { reason: v0.reason });

    const packPrompt: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `
  너는 출력 포맷터다.
  아래 스키마를 만족하는 "순수 JSON"만 출력해라. (코드블록/설명 금지)
  
  스키마:
  {
    "version": "v1",
    "title": string,
    "markdown": string,
    "citations": [{"source": string, "url"?: string, "quote"?: string}],
    "warnings": string[]
  }
  
  제약:
  - citations는 최소 1개 이상.
  - markdown에는 일본어 가나(히라가나/가타카나) 포함 금지.
  - markdown에는 "~~" 포함 금지.
  - markdown은 입력 내용을 가능한 한 유지하되, 규칙 위반 요소만 제거/수정.
  `.trim(),
      },
      {
        role: "user",
        content: `
  [입력 마크다운]
  ${params.finalMarkdown}
  
  [근거 후보]
  ${params.evidenceText}
  
  위 두 정보를 바탕으로 citations를 최소 1개 이상 구성해라.
  근거 후보에서 URL/문장이 있으면 quote/url로 써라.
  URL/문장이 없으면 source는 "internal_db"로 두고 quote는 생략해도 된다.
  `.trim(),
      },
    ];

    const r = await this.openai.chat.completions.create({
      model: this.modelName,
      messages: packPrompt,
      temperature: 0,
    });

    const raw = r.choices?.[0]?.message?.content ?? "";
    const jsonText = extractJsonObject(raw) ?? raw;

    let obj: any;
    try {
      obj = JSON.parse(jsonText);
    } catch {
      return sanitizeMarkdown(params.finalMarkdown.trim());
    }

    const v1 = validateAdviceOutput(obj);
    if (v1.ok) return v1.value.markdown.trim();

    // 1회 repair
    const repair = await this.openai.chat.completions.create({
      model: this.modelName,
      messages: [
        {
          role: "system",
          content: `너는 JSON修正기다. 오직 "순수 JSON"만 출력해라.`,
        },
        {
          role: "user",
          content: `
  아래 JSON이 검증에 실패했다.
  실패 사유: ${v1.reason}
  
  스키마/제약을 만족하도록 JSON만 고쳐서 다시 출력해라.
  (코드블록/설명 금지)
  
  [실패 JSON]
  ${jsonText}
  `.trim(),
        },
      ],
      temperature: 0,
    });

    const repairRaw = repair.choices?.[0]?.message?.content ?? "";
    const repairJsonText = extractJsonObject(repairRaw) ?? repairRaw;

    try {
      const repairedObj = JSON.parse(repairJsonText);
      const v2 = validateAdviceOutput(repairedObj);
      if (v2.ok) return v2.value.markdown.trim();
    } catch {}

    return sanitizeMarkdown(params.finalMarkdown.trim());
  }

  private async finalizeAdviceOutput(
    markdown: string,
    toolMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    onStage?: AdviceStageCb
  ): Promise<string> {
    const extractJsonObject = (s: string) => {
      const start = s.indexOf("{");
      const end = s.lastIndexOf("}");
      if (start === -1 || end === -1 || end <= start) return null;
      return s.slice(start, end + 1);
    };

    const sanitizeMarkdown = (md: string) =>
      md.replace(/[\u3040-\u30ff]/g, "").replace(/~~/g, "");

    type Citation = { source: string; url?: string; quote?: string };

    const buildCitationsFromToolMessages = (
      msgs: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
    ): Citation[] => {
      const citations: Citation[] = [];

      for (const m of msgs) {
        const content =
          typeof m.content === "string" ? m.content : JSON.stringify(m.content);

        let obj: any = null;
        try {
          obj = JSON.parse(content);
        } catch {
          continue;
        }
        if (!obj || obj.ok !== true) continue;

        if (obj.tool === "search_trends" && Array.isArray(obj.docs)) {
          for (const d of obj.docs.slice(0, 3)) {
            const source =
              String(d?.source ?? "naver_blog").trim() || "naver_blog";
            const url =
              typeof d?.url === "string" && d.url.trim() ? d.url : undefined;
            const quoteRaw =
              typeof d?.content === "string"
                ? d.content
                : typeof d?.text === "string"
                ? d.text
                : "";
            const quote = quoteRaw.trim().slice(0, 180) || undefined;

            citations.push({ source, url, quote });
          }
        }

        if (obj.tool === "get_rent_info" && obj.rent) {
          const dongName = typeof obj.dongName === "string" ? obj.dongName : "";
          citations.push({
            source: "rent_info",
            quote: dongName
              ? `${dongName} 임대/매매 요약 데이터 참조`
              : "임대/매매 요약 데이터 참조",
          });
        }
      }

      if (citations.length === 0) citations.push({ source: "internal_db" });
      return citations;
    };

    // 1) 1차: “이미 스키마 만족”하면 pack 없이 끝
    const draftObj = {
      version: "v1",
      title: "AI 상권 리포트",
      markdown: markdown.trim(),
      citations: buildCitationsFromToolMessages(toolMessages),
      warnings: [] as string[],
    };

    const v0 = validateAdviceOutput(draftObj);
    if (v0.ok) return v0.value.markdown.trim();

    await onStage?.("finalizing", { reason: v0.reason });

    // tool evidence 문자열
    const toolEvidence = toolMessages
      .map((m) =>
        typeof m.content === "string" ? m.content : JSON.stringify(m.content)
      )
      .join("\n\n");

    // 2) pack 1회 + validate
    const packPrompt: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `
  너는 출력 포맷터다.
  아래 스키마를 만족하는 "순수 JSON"만 출력해라. (코드블록/설명 금지)
  
  스키마:
  {
    "version": "v1",
    "title": string,
    "markdown": string,
    "citations": [{"source": string, "url"?: string, "quote"?: string}],
    "warnings": string[]
  }
  
  제약:
  - citations는 최소 1개 이상.
  - markdown에는 일본어 가나(히라가나/가타카나) 포함 금지.
  - markdown에는 "~~" 포함 금지.
  - markdown은 입력 내용을 가능한 한 유지하되, 규칙 위반 요소만 제거/수정.
  `.trim(),
      },
      {
        role: "user",
        content: `
  [입력 마크다운]
  ${markdown}
  
  [도구 결과(근거 후보)]
  ${toolEvidence}
  
  위 두 정보를 바탕으로 citations를 최소 1개 이상 구성해라.
  URL/문장이 있으면 quote/url로 써라.
  없으면 source는 "internal_db"로 두어도 된다.
  `.trim(),
      },
    ];

    const r = await this.openai.chat.completions.create({
      model: this.modelName,
      messages: packPrompt,
      temperature: 0,
    });

    const raw = r.choices?.[0]?.message?.content ?? "";
    const jsonText = extractJsonObject(raw) ?? raw;

    let obj: any;
    try {
      obj = JSON.parse(jsonText);
    } catch {
      return sanitizeMarkdown(markdown.trim());
    }

    const v1 = validateAdviceOutput(obj);
    if (v1.ok) return v1.value.markdown.trim();

    // 3) repair 1회
    const repair = await this.openai.chat.completions.create({
      model: this.modelName,
      messages: [
        {
          role: "system",
          content: `너는 JSON修正기다. 오직 "순수 JSON"만 출력해라.`,
        },
        {
          role: "user",
          content: `
  아래 JSON이 검증에 실패했다.
  실패 사유: ${v1.reason}
  
  스키마/제약을 만족하도록 JSON만 고쳐서 다시 출력해라.
  (코드블록/설명 금지)
  
  [실패 JSON]
  ${jsonText}
  `.trim(),
        },
      ],
      temperature: 0,
    });

    const repairRaw = repair.choices?.[0]?.message?.content ?? "";
    const repairJsonText = extractJsonObject(repairRaw) ?? repairRaw;

    try {
      const repairedObj = JSON.parse(repairJsonText);
      const v2 = validateAdviceOutput(repairedObj);
      if (v2.ok) return v2.value.markdown.trim();
    } catch {
      // ignore
    }

    // 4) 최후 fallback
    return sanitizeMarkdown(markdown.trim());
  }

  private traceEvidenceUsedLite(
    finalMarkdown: string,
    toolMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  ) {
    if (process.env.ADVICE_TRACE !== "1") return;

    let trendDocs: any[] = [];
    let naverQuery = "";
    let rentHasData = false;
    let rentDong = "";

    for (const m of toolMessages) {
      const content =
        typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      let obj: any;
      try {
        obj = JSON.parse(content);
      } catch {
        continue;
      }
      if (!obj || obj.ok !== true) continue;

      if (obj.tool === "search_trends") {
        trendDocs = Array.isArray(obj.docs) ? obj.docs : [];
        naverQuery = typeof obj.naverQuery === "string" ? obj.naverQuery : "";
      }
      if (obj.tool === "get_rent_info") {
        rentHasData = !!obj.rent;
        rentDong = typeof obj.dongName === "string" ? obj.dongName : "";
      }
    }

    // 트렌드 키워드(한글 2글자 이상) 몇 개 뽑아서 답변에 포함됐는지 확인
    const text = trendDocs
      .slice(0, 3)
      .map((d) => String(d?.content ?? d?.text ?? ""))
      .join(" ");
    const keywords = Array.from(new Set(text.match(/[가-힣]{2,}/g) ?? []))
      .filter((w) => w.length >= 2)
      .slice(0, 12);

    const hits = keywords.filter((k) => finalMarkdown.includes(k)).slice(0, 8);

    const hasTrendSentence = finalMarkdown.includes("최근 온라인 트렌드에서는");
    const hasRentSentence = finalMarkdown.includes("임대/매매 관점에서는");

    this.logger.log(
      `[AdviceTrace] evidence_check ` +
        `trend.docs=${trendDocs.length} trend.naverQuery="${naverQuery}" ` +
        `rent.hasData=${rentHasData} rent.dong="${rentDong}"`
    );
    this.logger.log(
      `[AdviceTrace] evidence_used ` +
        `requiredTrendSentence=${hasTrendSentence} requiredRentSentence=${hasRentSentence} ` +
        `trend.keywordHit=${hits.length}/${keywords.length} hits=${hits.join(
          ","
        )}`
    );
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
    question: string,
    onDelta?: (text: string) => void | Promise<void>,
    onStage?: AdviceStageCb
  ): Promise<string> {
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

      endPre();

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

      const { content, toolsUsed, toolMessages } =
        await this.runAdviceCompletionWithTools(
          baseMessages,
          trendAreaKeyword,
          onDelta,
          onStage
        );

      endFinalLLM();

      const finalMarkdown = await this.finalizeAdviceOutput(
        content,
        toolMessages,
        onStage
      );
      this.traceEvidenceUsedLite(finalMarkdown, toolMessages);

      return finalMarkdown;
    } finally {
      // ✅ 어떤 return/throw가 나도 TOTAL은 무조건 종료
      endTotal();
      if (endPre) endPre = null;
      if (endSlim) endSlim = null;
      if (endFinalLLM) endFinalLLM = null;
    }
  }
}
