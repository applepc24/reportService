// src/modules/traffic/traffic.service.ts
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TrafficMetric } from './entities/traffic-metric.entity';

@Injectable()
export class TrafficService {
  private readonly logger = new Logger(TrafficService.name);
  private readonly baseUrl = 'http://openapi.seoul.go.kr:8088';
  private readonly serviceName = 'VwsmAdstrdFlpopW';

  constructor(
    @InjectRepository(TrafficMetric)
    private readonly trafficRepo: Repository<TrafficMetric>,
  ) {}

  async importQuarter(apiKey: string, yyyq: string): Promise<number> {
    const pageSize = 1000;
    let inserted = 0;
  
    // 1) 먼저 1~pageSize 한 번 호출해서 총 개수(list_total_count) 확인
    const firstUrl = `${this.baseUrl}/${apiKey}/json/${this.serviceName}/1/${pageSize}/${yyyq}`;
    this.logger.log(`Fetching traffic data first page: ${firstUrl}`);
    const firstRes = await axios.get(firstUrl);
  
    const root = firstRes.data?.[this.serviceName];
    if (!root) {
      this.logger.error('Unexpected response structure', firstRes.data);
      return 0;
    }
  
    const totalCount: number = root.list_total_count ?? 0;
    let rows = root.row ?? [];
  
    for (const r of rows) {
      const entity = this.trafficRepo.create({
        dongCode: r.ADSTRD_CD,
        dongName: r.ADSTRD_CD_NM,
        period: r.STDR_YYQU_CD,
        totalFootfall: r.TOT_FLPOP_CO,
        maleFootfall: r.ML_FLPOP_CO,
        femaleFootfall: r.FML_FLPOP_CO,
        age10: r.AGRDE_10_FLPOP_CO,
        age20: r.AGRDE_20_FLPOP_CO,
        age30: r.AGRDE_30_FLPOP_CO,
        age40: r.AGRDE_40_FLPOP_CO,
        age50: r.AGRDE_50_FLPOP_CO,
        age60Plus: r.AGRDE_60_ABOVE_FLPOP_CO,
        tm00_06: r.TMZON_00_06_FLPOP_CO,
        tm06_11: r.TMZON_06_11_FLPOP_CO,
        tm11_14: r.TMZON_11_14_FLPOP_CO,
        tm14_17: r.TMZON_14_17_FLPOP_CO,
        tm17_21: r.TMZON_17_21_FLPOP_CO,
        tm21_24: r.TMZON_21_24_FLPOP_CO,
        mon: r.MON_FLPOP_CO,
        tue: r.TUES_FLPOP_CO,
        wed: r.WED_FLPOP_CO,
        thu: r.THUR_FLPOP_CO,
        fri: r.FRI_FLPOP_CO,
        sat: r.SAT_FLPOP_CO,
        sun: r.SUN_FLPOP_CO,
      });
      await this.trafficRepo.save(entity);
      inserted++;
    }
  
    // 2) 나머지 페이지 루프
    let start = pageSize + 1;
    while (start <= totalCount) {
      const end = Math.min(start + pageSize - 1, totalCount);
      const url = `${this.baseUrl}/${apiKey}/json/${this.serviceName}/${start}/${end}/${yyyq}`;
      this.logger.log(`Fetching traffic data: ${url}`);
      const res = await axios.get(url);
      rows = res.data?.[this.serviceName]?.row ?? [];
  
      for (const r of rows) {
        const entity = this.trafficRepo.create({
          dongCode: r.ADSTRD_CD,
          dongName: r.ADSTRD_CD_NM,
          period: r.STDR_YYQU_CD,
          totalFootfall: r.TOT_FLPOP_CO,
          maleFootfall: r.ML_FLPOP_CO,
          femaleFootfall: r.FML_FLPOP_CO,
          age10: r.AGRDE_10_FLPOP_CO,
          age20: r.AGRDE_20_FLPOP_CO,
          age30: r.AGRDE_30_FLPOP_CO,
          age40: r.AGRDE_40_FLPOP_CO,
          age50: r.AGRDE_50_FLPOP_CO,
          age60Plus: r.AGRDE_60_ABOVE_FLPOP_CO,
          tm00_06: r.TMZON_00_06_FLPOP_CO,
          tm06_11: r.TMZON_06_11_FLPOP_CO,
          tm11_14: r.TMZON_11_14_FLPOP_CO,
          tm14_17: r.TMZON_14_17_FLPOP_CO,
          tm17_21: r.TMZON_17_21_FLPOP_CO,
          tm21_24: r.TMZON_21_24_FLPOP_CO,
          mon: r.MON_FLPOP_CO,
          tue: r.TUES_FLPOP_CO,
          wed: r.WED_FLPOP_CO,
          thu: r.THUR_FLPOP_CO,
          fri: r.FRI_FLPOP_CO,
          sat: r.SAT_FLPOP_CO,
          sun: r.SUN_FLPOP_CO,
        });
        await this.trafficRepo.save(entity);
        inserted++;
      }
  
      start = end + 1;
    }
  
    this.logger.log(
      `✅ inserted ${inserted} traffic rows for period=${yyyq} (totalCount=${totalCount})`,
    );
    return inserted;
  }

  async getLatestByDongName(dongName: string): Promise<TrafficMetric | null> {
    return this.trafficRepo.findOne({
      where: { dongName },
      order: { period: 'DESC' },
    });
  }
  
  calcSummary(metric: TrafficMetric | null) {
    if (!metric) return null;
  
    const total = Number(metric.totalFootfall ?? 0);
    if (total === 0) return null;
  
    const age20 = Number(metric.age20 ?? 0);
    const evening =
      Number(metric.tm17_21 ?? 0) + Number(metric.tm21_24 ?? 0);
  
    return {
      totalFootfall: total,
      age20sRatio: Number((age20 / total).toFixed(3)),
      eveningRatio: Number((evening / total).toFixed(3)),
    };
  }
}