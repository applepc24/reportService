import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { SalesMetric } from "./entities/sales_metric.entity";
import { DataSource } from 'typeorm';

export interface SalesSummary {
  period: string;
  totalAmt: number; // 전체(술집 관련 업종 합) 금액
  weekendRatio: number; // 주말 비중 (0~1)
  peakTimeSlot: string; // '11-14' 같은 레이블
}

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);
  private readonly baseUrl = "http://openapi.seoul.go.kr:8088";
  private readonly serviceName = "VwsmAdstrdSelngW"; // 매출(행정동, 분기)

  constructor(
    @InjectRepository(SalesMetric)
    private readonly repo: Repository<SalesMetric>,
    private readonly dataSource: DataSource,
  ) {}

  private toBigintString(v: any): string {
    if (v === null || v === undefined || v === "") return "0";
    const n = Number(v);
    return Number.isFinite(n) ? String(Math.trunc(n)) : "0";
  }
  private toInt(v: any): number {
    if (v === null || v === undefined || v === "") return 0;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }

  // 업종명이 '술집' 계열인지 여부 (키워드 개선 가능)
  // 복합 업종명(예: "호프-간이주점", "바(Bar)/와인바")도 안전하게 매칭
  private isAlcohol(svcName: string, svcCode?: string): boolean {
    if (!svcName) return false;

    // 1) 정규화: 소문자, 공백양끝 정리
    const raw = svcName.trim().toLowerCase();

    // 2) 구분자 기준 토큰화: 공백/슬래시/하이픈/점/중점/괄호/쉼표 등
    //   예: "호프-간이주점" -> ["호프","간이주점"]
    //       "바(Bar)/와인바" -> ["바","bar","와인바"]
    const tokens = raw.split(/[\s\/\-\.\·\(\)\[\]\{\},]+/g).filter(Boolean);

    // 3) 토큰 기준 허용/제외 리스트
    //    (서울시 업종명에 자주 나오는 표기 위주)
    const ALLOW = new Set([
      "주점",
      "간이주점",
      "요리주점",
      "호프",
      "펍",
      "pub",
      "바",
      "bar",
      "칵테일",
      "칵테일바",
      "와인바",
      "이자카야",
    ]);

    const DENY = new Set([
      "한식음식점",
      "중식음식점",
      "일식음식점",
      "양식음식점",
      "분식",
      "치킨",
      "피자",
      "족발보쌈",
      "패스트푸드",
      "카페",
      "제과제빵",
      "아이스크림",
    ]);

    // 4) 토큰 중 하나라도 ALLOW면 술집으로 간주
    if (tokens.some((t) => ALLOW.has(t))) return true;

    // 5) 토큰에 명시 제외가 섞여 있으면 제외 (모호한 경우 대비)
    if (tokens.some((t) => DENY.has(t))) return false;

    // 6) 마지막 안전장치: 원문 문자열에도 포함 여부 한번 더 체크
    //    (예: "호프-간이주점" 같은 복합이 토큰화에서 빠지지 않았는지)
    const joined = tokens.join("");
    if (
      [
        "요리주점",
        "간이주점",
        "호프",
        "와인바",
        "칵테일바",
        "이자카야",
        "펍",
        "바",
        "bar",
        "pub",
      ].some((k) => raw.includes(k) || joined.includes(k))
    ) {
      return true;
    }

    // 모호하면 보수적으로 false
    return false;
  }

  async importQuarter(apiKey: string, period: string): Promise<number> {
    const pageSize = 1000;
    // 1) 첫 페이지
    const firstUrl = `${this.baseUrl}/${apiKey}/json/${this.serviceName}/1/${pageSize}/${period}`;
    const first = await axios.get(firstUrl);
    const root = first.data?.[this.serviceName];
    if (!root) {
      this.logger.error("Unexpected response", first.data);
      return 0;
    }
    const totalCount: number = root.list_total_count ?? 0;
    let rows: any[] = root.row ?? [];
    let inserted = 0;

    inserted += await this.saveRows(rows);

    // 2) 페이징
    let start = pageSize + 1;
    while (start <= totalCount) {
      const end = Math.min(start + pageSize - 1, totalCount);
      const url = `${this.baseUrl}/${apiKey}/json/${this.serviceName}/${start}/${end}/${period}`;
      const res = await axios.get(url);
      rows = res.data?.[this.serviceName]?.row ?? [];
      inserted += await this.saveRows(rows);
      start = end + 1;
    }

    this.logger.log(
      `✅ Sales inserted=${inserted} period=${period} total=${totalCount}`
    );
    return inserted;
  }

  private async saveRows(rows: any[]): Promise<number> {
    let cnt = 0;
    for (const r of rows) {
      const svcName = String(r.SVC_INDUTY_CD_NM || "");
      // ⬇️ 여기서 비-주점 업종은 건너뜀
      if (!this.isAlcohol(svcName)) continue;
      const e = this.repo.create({
        period: String(r.STDR_YYQU_CD),
        dongCode: String(r.ADSTRD_CD),
        dongName: String(r.ADSTRD_CD_NM),
        svcCode: String(r.SVC_INDUTY_CD),
        svcName: String(r.SVC_INDUTY_CD_NM),

        thsmonSelngAmt: this.toBigintString(r.THSMON_SELNG_AMT),
        mdwkSelngAmt: this.toBigintString(r.MDWK_SELNG_AMT),
        wkendSelngAmt: this.toBigintString(r.WKEND_SELNG_AMT),

        monSelngAmt: this.toBigintString(r.MON_SELNG_AMT),
        tuesSelngAmt: this.toBigintString(r.TUES_SELNG_AMT),
        wedSelngAmt: this.toBigintString(r.WED_SELNG_AMT),
        thurSelngAmt: this.toBigintString(r.THUR_SELNG_AMT),
        friSelngAmt: this.toBigintString(r.FRI_SELNG_AMT),
        satSelngAmt: this.toBigintString(r.SAT_SELNG_AMT),
        sunSelngAmt: this.toBigintString(r.SUN_SELNG_AMT),

        tm00_06Amt: this.toBigintString(r.TMZON_00_06_SELNG_AMT),
        tm06_11Amt: this.toBigintString(r.TMZON_06_11_SELNG_AMT),
        tm11_14Amt: this.toBigintString(r.TMZON_11_14_SELNG_AMT),
        tm14_17Amt: this.toBigintString(r.TMZON_14_17_SELNG_AMT),
        tm17_21Amt: this.toBigintString(r.TMZON_17_21_SELNG_AMT),
        tm21_24Amt: this.toBigintString(r.TMZON_21_24_SELNG_AMT),

        thsmonSelngCo: this.toInt(r.THSMON_SELNG_CO),
        mdwkSelngCo: this.toInt(r.MDWK_SELNG_CO),
        wkendSelngCo: this.toInt(r.WKEND_SELNG_CO),

        maleSelngAmt: this.toBigintString(r.ML_SELNG_AMT),
        femaleSelngAmt: this.toBigintString(r.FML_SELNG_AMT),

        age10SelngAmt: this.toBigintString(r.AGRDE_10_SELNG_AMT),
        age20SelngAmt: this.toBigintString(r.AGRDE_20_SELNG_AMT),
        age30SelngAmt: this.toBigintString(r.AGRDE_30_SELNG_AMT),
        age40SelngAmt: this.toBigintString(r.AGRDE_40_SELNG_AMT),
        age50SelngAmt: this.toBigintString(r.AGRDE_50_SELNG_AMT),
        age60SelngAmt: this.toBigintString(r.AGRDE_60_ABOVE_SELNG_AMT),
      });
      await this.repo.save(e);
      cnt++;
    }
    return cnt;
  }

  // 최신 분기의 “술집 관련 업종”만 합산한 매출 요약
  async getLatestAlcoholSalesSummaryByDongCode(
    dongCode: string
  ): Promise<SalesSummary | null> {
    // 최신 period 파악
    const latest = await this.repo.findOne({
      where: { dongCode },
      order: { period: "DESC", id: "DESC" },
    });
    if (!latest) return null;
    const period = latest.period;

    // 같은 분기/동 데이터 중 “술집 관련 업종” 필터
    const rows = await this.repo.find({ where: { dongCode, period } });
    const alcoholRows = rows.filter((r) => this.isAlcohol(r.svcName));
    if (alcoholRows.length === 0) {
      return { period, totalAmt: 0, weekendRatio: 0, peakTimeSlot: "" };
    }

    const toNum = (v: unknown): number => {
      if (typeof v === "number") return Number.isFinite(v) ? v : 0;
      if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      }
      return 0;
    };

    const sum = (arr: Array<number | string | null | undefined>) => {
      const nums: number[] = arr.map(toNum); // number[] 확정
      return nums.reduce((acc, v) => acc + v, 0); // 초기값 0
    };

    const totalAmt = sum(alcoholRows.map((r) => r.thsmonSelngAmt));
    const wkendAmt = sum(alcoholRows.map((r) => r.wkendSelngAmt));

    const slots = [
      { key: "00-06", v: sum(alcoholRows.map((r) => r.tm00_06Amt)) },
      { key: "06-11", v: sum(alcoholRows.map((r) => r.tm06_11Amt)) },
      { key: "11-14", v: sum(alcoholRows.map((r) => r.tm11_14Amt)) },
      { key: "14-17", v: sum(alcoholRows.map((r) => r.tm14_17Amt)) },
      { key: "17-21", v: sum(alcoholRows.map((r) => r.tm17_21Amt)) },
      { key: "21-24", v: sum(alcoholRows.map((r) => r.tm21_24Amt)) },
    ];
    let peakTimeSlot = "";
    let max = -1;
    for (const s of slots) {
      if (s.v > max) {
        max = s.v;
        peakTimeSlot = s.key;
      }
    }

    return {
      period,
      totalAmt,
      weekendRatio: totalAmt > 0 ? wkendAmt / totalAmt : 0,
      peakTimeSlot,
    };
  }

  async refreshDongQuarterView(): Promise<void> {
    await this.dataSource.query('REFRESH MATERIALIZED VIEW mv_dong_quarter');
  }
}
