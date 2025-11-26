// apps/api/src/modules/rent-info/rent-info.service.ts
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { RentInfoSummary } from "./rent-info.types";
import { parseSigungucolumn } from "./rent-info.util";
import * as fs from "fs";
import * as readline from "readline";
import * as iconv from "iconv-lite";

type ColIndex = {
  sigungu: number;
  price: number;
  area: number;
  contractYm: number;
  contractDay: number;
};

@Injectable()
export class RentInfoService implements OnModuleInit {
  private readonly logger = new Logger(RentInfoService.name);

  /** 동별 요약 */
  private rentSummaryByDong: Map<string, RentInfoSummary> = new Map();

  async onModuleInit() {
    const csvPath = process.env.RENT_INFO_CSV_PATH;
    if (!csvPath) {
      this.logger.warn(
        "[RentInfoService] RENT_INFO_CSV_PATH 환경변수가 설정되지 않아 CSV를 로드하지 않습니다."
      );
      return;
    }

    try {
      await this.loadFromCsv(csvPath);
      this.logger.log(
        `[RentInfoService] CSV 로딩 완료: file=${csvPath}, dongCount=${this.rentSummaryByDong.size}`
      );

      this.logger.debug(
        `[RentInfoService] keys sample = ${Array.from(
          this.rentSummaryByDong.keys()
        )
          .slice(0, 20)
          .join(", ")}`
      );
    } catch (e) {
      this.logger.error(
        `[RentInfoService] CSV 로딩 중 오류 발생: file=${csvPath}`,
        e as any
      );
    }
  }

  private normalizeDongName(name: string): string {
    return (name ?? "")
      .replace(/\uFEFF/g, "")
      .replace(/"/g, "")
      .replace(/\s+/g, "")
      .trim();
  }

  private canonicalizeDongName(raw: string): string {
    // 기존 normalize(공백/따옴표/BOM 등 제거) + 1동/2동 → 동 처리
    const s = this.normalizeDongName(raw).replace(/\d+동$/, "동");

    // 이미 동/가로 끝나면 그대로
    if (s.endsWith("동") || s.endsWith("가")) return s;

    // ✅ 너가 원하는 핵심: “~로”, “~길”이면 “동”을 붙여서 저장
    if (s.endsWith("로") || s.endsWith("길")) return `${s}동`;

    // 기타(혹시라도 “서초” 같은 형태면 동을 붙여주는 쪽이 실사용에 유리)
    return `${s}동`;
  }

  /** CSV 한 줄 파서(따옴표/콤마 처리) */
  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        result.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    result.push(cur);

    return result.map((v) => v.replace(/^\uFEFF/, "").trim());
  }

  private parseNumber(value: string | null | undefined): number | null {
    if (value == null) return null;
    const trimmed = value.replace(/,/g, "").trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }

  private parseContractDate(ymRaw: string, dayRaw: string): Date | null {
    const ym = (ymRaw ?? "").trim();
    const day = (dayRaw ?? "").trim();
    if (ym.length !== 6 || !day) return null;

    const year = ym.slice(0, 4);
    const month = ym.slice(4, 6);
    const dd = day.padStart(2, "0");
    const iso = `${year}-${month}-${dd}`;

    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private isHeaderRow(cols: string[]): boolean {
    if (cols.length < 10) return false;
    if ((cols[0] ?? "").replace(/"/g, "").trim() !== "NO") return false;

    // 메타데이터 줄("시군구 : 전체") 같은 애들 컷하기 위해 “필수 컬럼들”을 같이 검사
    const must = [
      "시군구",
      "전용/연면적(㎡)",
      "거래금액(만원)",
      "계약년월",
      "계약일",
    ];
    return must.every((m) => cols.some((c) => c.includes(m)));
  }

  private buildColIndex(header: string[]): ColIndex {
    const idx = (name: string) => header.findIndex((h) => h.includes(name));

    const sigungu = idx("시군구");
    const area = idx("전용/연면적");
    const price = idx("거래금액");
    const contractYm = idx("계약년월");
    const contractDay = idx("계약일");

    if ([sigungu, area, price, contractYm, contractDay].some((x) => x < 0)) {
      throw new Error(
        `[RentInfoService] required columns not found in header: ${header.join(
          " | "
        )}`
      );
    }

    return { sigungu, area, price, contractYm, contractDay };
  }

  private async loadFromCsv(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      this.logger.warn(
        `[RentInfoService] CSV 파일을 찾을 수 없습니다: ${filePath}`
      );
      return;
    }

    // ✅ 국토부 실거래가 CSV는 보통 EUC-KR
    this.logger.log(`[RentInfoService] CSV 로딩 시작: ${filePath}`);
    this.logger.log(`[RentInfoService] decode = euc-kr`);

    type DongAgg = {
      dongName: string;
      count: number;
      minPrice: number | null;
      maxPrice: number | null;
      sumPricePerM2: number;
      cntPricePerM2: number;
      recentContractDate: Date | null;
    };

    const aggByDong: Map<string, DongAgg> = new Map();

    const stream = fs
      .createReadStream(filePath)
      .pipe(iconv.decodeStream("euc-kr"));
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let header: string[] | null = null;
    let colIndex: ColIndex | null = null;

    for await (const lineRaw of rl) {
      const line = (lineRaw ?? "").trim();
      if (!line) continue;

      const cols = this.parseCsvLine(line);

      // 1) 헤더 찾기: 메타 줄 무시하고 "NO, 시군구, ..." 줄만 잡는다
      if (!header) {
        if (!this.isHeaderRow(cols)) continue;

        header = cols;
        colIndex = this.buildColIndex(header);

        this.logger.debug(
          `[RentInfoService] header found: ${header.join(" | ")}`
        );
        this.logger.debug(
          `[RentInfoService] colIndex = ${JSON.stringify(colIndex)}`
        );
        continue;
      }

      // 2) 데이터 라인: NO가 숫자인 줄만 처리 (메타 줄/깨진 줄 방지)
      if (!/^\d+$/.test((cols[0] ?? "").trim())) continue;
      if (!colIndex) continue;

      const sigunguField = (cols[colIndex.sigungu] ?? "").trim();
      const { emdNameBase } = parseSigungucolumn(sigunguField);

      if (!emdNameBase) {
        // 너무 많이 찍히면 noisy하니까, 필요할 때만 debug 레벨로
        // this.logger.debug(`[RentInfoService] no emdNameBase: "${sigunguField}"`);
        continue;
      }

      const price = this.parseNumber(cols[colIndex.price]);
      const area = this.parseNumber(cols[colIndex.area]);
      const contractDate = this.parseContractDate(
        cols[colIndex.contractYm],
        cols[colIndex.contractDay]
      );

      const key = this.canonicalizeDongName(emdNameBase);
      let agg = aggByDong.get(key);
      if (!agg) {
        agg = {
          dongName: key,
          count: 0,
          minPrice: null,
          maxPrice: null,
          sumPricePerM2: 0,
          cntPricePerM2: 0,
          recentContractDate: null,
        };
        aggByDong.set(key, agg);
      }

      agg.count += 1;

      if (price != null) {
        agg.minPrice =
          agg.minPrice == null ? price : Math.min(agg.minPrice, price);
        agg.maxPrice =
          agg.maxPrice == null ? price : Math.max(agg.maxPrice, price);
      }

      if (price != null && area != null && area > 0) {
        const pricePerM2 = price / area; // (만원/㎡)
        agg.sumPricePerM2 += pricePerM2;
        agg.cntPricePerM2 += 1;
      }

      if (contractDate) {
        if (!agg.recentContractDate || contractDate > agg.recentContractDate) {
          agg.recentContractDate = contractDate;
        }
      }
    }

    // Map 채우기
    this.rentSummaryByDong.clear();

    for (const [key, agg] of aggByDong.entries()) {
      const avgTradePricePerM2Manwon =
        agg.cntPricePerM2 > 0 ? agg.sumPricePerM2 / agg.cntPricePerM2 : null;

      const avgTradePricePerM2Won =
        avgTradePricePerM2Manwon == null
          ? null
          : avgTradePricePerM2Manwon * 10000;

      const summary: RentInfoSummary = {
        dongName: key,
        sampleCount: agg.count,
        minPrice: agg.minPrice,
        maxPrice: agg.maxPrice,
        avgTradePricePerM2Manwon,
        avgTradePricePerM2Won,
        recentContractDate: agg.recentContractDate
          ? agg.recentContractDate.toISOString().slice(0, 10)
          : null,
        // 아직 퍼센타일/총액 평균은 계산 안 하니까 null
        p25PricePerM2: null,
        p50PricePerM2: null,
        p75PricePerM2: null,
        avgTotalPrice: null,
      };

      this.rentSummaryByDong.set(key, summary);
    }
  }

  // apps/api/src/modules/rent-info/rent-info.service.ts

  async getSummaryByDongName(
    dongName: string
  ): Promise<RentInfoSummary | null> {
    const inputRaw = dongName ?? "";

    // ✅ 1) canonical 키로 먼저 직조회 (가장 중요)
    const canonicalInput = this.canonicalizeDongName(inputRaw);
    const direct = this.rentSummaryByDong.get(canonicalInput);
    if (direct) return direct;

    // ✅ 2) 혹시 저장 키가 예외적으로 canonicalize 전 형태가 남아있을 가능성 대비
    const normalizedInput = this.normalizeDongName(inputRaw);
    const normalizedInputBase = normalizedInput.replace(/(\d+)동$/, "동");

    for (const [key, summary] of this.rentSummaryByDong.entries()) {
      const canonKey = this.canonicalizeDongName(key);
      if (canonKey === canonicalInput) {
        this.logger.debug(
          `[RentInfoService] canonical match: input="${inputRaw}" -> key="${key}"`
        );
        return summary;
      }

      // (보조) 기존 규칙 기반 매칭
      const normKey = this.normalizeDongName(key);
      const normKeyBase = normKey.replace(/(\d+)동$/, "동");
      if (normKey === normalizedInput || normKeyBase === normalizedInputBase) {
        this.logger.debug(
          `[RentInfoService] normalized/base match: input="${inputRaw}" -> key="${key}"`
        );
        return summary;
      }
    }

    this.logger.debug(
      `[RentInfoService] no rent summary for dongName="${inputRaw}", canonical="${canonicalInput}"`
    );
    return null;
  }
}
