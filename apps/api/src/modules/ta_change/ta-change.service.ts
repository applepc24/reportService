// src/modules/ta-change/ta-change.service.ts
import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { TAChangeMetric } from "./entities/ta_change_metric.entity";

@Injectable()
export class TAChangeService {
  private readonly logger = new Logger(TAChangeService.name);
  private readonly baseUrl = "http://openapi.seoul.go.kr:8088";
  private readonly serviceName = "VwsmAdstrdIxQq"; // 상권변화지표(행정동, 분기)

  constructor(
    @InjectRepository(TAChangeMetric)
    private readonly repo: Repository<TAChangeMetric>
  ) {}

  // 분기 단위 전체 페이지 수집
  async importQuarter(apiKey: string, period: string): Promise<number> {
    const pageSize = 1000;
    // 1) 첫 페이지로 total_count 확인
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
    // 첫 페이지 저장
    inserted += await this.saveRows(rows);

    // 2) 남은 페이지 루프
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
      `✅ TAChange inserted=${inserted} period=${period} total=${totalCount}`
    );
    return inserted;
  }

  private async saveRows(rows: any[]): Promise<number> {
    let cnt = 0;
    const nameToCode: Record<string, "LL" | "LH" | "HL" | "HH"> = {
      다이나믹: "LL",
      상권확장: "LH",
      상권축소: "HL",
      정체: "HH",
    };
    for (const r of rows) {
      const rawCode = String(r.TRDAR_CHNGE_IX ?? "").trim(); // 예: "LL"
      const rawName = String(r.TRDAR_CHNGE_IX_NM ?? "").trim();

      const changeIndex = (["LL", "LH", "HL", "HH"] as const).includes(
        rawCode as any
      )
        ? (rawCode as "LL" | "LH" | "HL" | "HH")
        : nameToCode[rawName] ?? null;

      const e = this.repo.create({
        period: String(r.STDR_YYQU_CD),
        dongCode: String(r.ADSTRD_CD),
        dongName: String(r.ADSTRD_CD_NM),
        changeIndex: changeIndex ?? undefined, // ✅ 문자열 코드로 저장
        changeIndexName: rawName || undefined,
        opRunMonthAvg:
          r.OPR_SALE_MT_AVRG != null ? Number(r.OPR_SALE_MT_AVRG) : null,
        clRunMonthAvg:
          r.CLS_SALE_MT_AVRG != null ? Number(r.CLS_SALE_MT_AVRG) : null,
        seoulOpRunMonthAvg:
          r.SU_OPR_SALE_MT_AVRG != null ? Number(r.SU_OPR_SALE_MT_AVRG) : null,
        seoulClRunMonthAvg:
          r.SU_CLS_SALE_MT_AVRG != null ? Number(r.SU_CLS_SALE_MT_AVRG) : null,
      });
      await this.repo.save(e);
      cnt++;
    }
    return cnt;
  }

  // 최신 분기 1건 가져오기
  async getLatestByDongCode(dongCode: string): Promise<TAChangeMetric | null> {
    return this.repo.findOne({
      where: { dongCode },
      order: { period: "DESC", id: "DESC" },
    });
  }
}
