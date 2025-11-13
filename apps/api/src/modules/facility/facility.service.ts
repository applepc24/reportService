import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { FacilityMetric } from "./entities/facility_metric.entity";

@Injectable()
export class FacilityService {
  private readonly logger = new Logger(FacilityService.name);
  private readonly baseUrl = "http://openapi.seoul.go.kr:8088";
  private readonly serviceName = "VwsmAdstrdFcltyW"; // 집객시설(행정동, 분기)

  constructor(
    @InjectRepository(FacilityMetric)
    private readonly repo: Repository<FacilityMetric>
  ) {}

  private toInt(v: any): number | null {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }

  async importQuarter(apiKey: string, period: string): Promise<number> {
    const pageSize = 1000;

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
      `✅ Facility inserted=${inserted} period=${period} total=${totalCount}`
    );
    return inserted;
  }

  private async saveRows(rows: any[]): Promise<number> {
    let cnt = 0;
    for (const r of rows) {
      // 약국 컬럼 오타 대응: PARMACY_CO(공식 표기) 우선, 없으면 PHARMACY_CO 폴백
      const pharmacyRaw = r.PARMACY_CO ?? r.PHARMACY_CO;

      const e = this.repo.create({
        period: String(r.STDR_YYQU_CD),
        dongCode: String(r.ADSTRD_CD),
        dongName: String(r.ADSTRD_CD_NM),

        viatrFacilityCount: this.toInt(r.VIATR_FCLTY_CO),
        publicOfficeCount: this.toInt(r.PBLOFC_CO),
        bankCount: this.toInt(r.BANK_CO),
        generalHospitalCount: this.toInt(r.GNRL_HSPTL_CO),
        pharmacyCount: this.toInt(pharmacyRaw),
        kindergartenCount: this.toInt(r.KNDRGR_CO),
        elementarySchoolCount: this.toInt(r.ELESCH_CO),
        middleSchoolCount: this.toInt(r.MSKUL_CO),
        highSchoolCount: this.toInt(r.HGSCHL_CO),
        universityCount: this.toInt(r.UNIV_CO),
        supermarketCount: this.toInt(r.SUPMK_CO),
        theaterCount: this.toInt(r.THEAT_CO),
        lodgingCount: this.toInt(r.STAYNG_FCLTY_CO),
        airportCount: this.toInt(r.ARPRT_CO),
        railroadStationCount: this.toInt(r.RLROAD_STATN_CO),
        busTerminalCount: this.toInt(r.BUS_TRMINL_CO),
        subwayStationCount: this.toInt(r.SUBWAY_STATN_CO),
        busStopCount: this.toInt(r.BUS_STTN_CO),
      });

      await this.repo.save(e);
      cnt++;
    }
    return cnt;
  }

  // 리포트용 최신 요약치 (가벼운 버전)
  async getLatestSummaryByDongCode(dongCode: string) {
    const latest = await this.repo.findOne({
      where: { dongCode },
      order: { period: "DESC", id: "DESC" },
    });
    if (!latest) return null;

    return {
      period: latest.period,
      viatrFacilityCount: latest.viatrFacilityCount ?? 0,
      universityCount: latest.universityCount ?? 0,
      subwayStationCount: latest.subwayStationCount ?? 0,
      busStopCount: latest.busStopCount ?? 0,
      bankCount: latest.bankCount ?? 0,
    };
  }
}
