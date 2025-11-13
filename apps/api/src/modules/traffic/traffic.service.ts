// src/modules/traffic/traffic.service.ts
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TrafficMetric } from './entities/traffic-metric.entity';

export interface TrafficSummary {
  period: string;          // '20251' 같은 분기 코드
  totalFootfall: number;   // 총 유동 인구
  maleRatio: number;       // 0~1
  femaleRatio: number;     // 0~1
  age20_30Ratio: number;   // 0~1 (20대+30대 비율)
  peakTimeSlot: string;    // '17-21' 이런 식으로
}

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

  async getLatestByDongCode(dongCode: string): Promise<TrafficMetric | null> {
    return this.trafficRepo.findOne({
      where: { dongCode },
      order: {
        period: 'DESC',  // '20251' > '20241' 이런 식으로
        id: 'DESC',      // 동일 period 안에서 가장 나중에 들어온 것
      },
    });
  }
  
  calcSummary(metric: TrafficMetric): TrafficSummary {
    const {
      period,
      totalFootfall,
      maleFootfall,
      femaleFootfall,
      age10,
      age20,
      age30,
      age40,
      age50,
      age60Plus,
      tm00_06,
      tm06_11,
      tm11_14,
      tm14_17,
      tm17_21,
      tm21_24,
    } = metric;

    const total = Number(totalFootfall) || 0;
    const male = Number(maleFootfall) || 0;
    const female = Number(femaleFootfall) || 0;

    const age20_30 =
      (Number(age20) || 0) +
      (Number(age30) || 0);

    const maleRatio = total > 0 ? male / total : 0;
    const femaleRatio = total > 0 ? female / total : 0;
    const age20_30Ratio = total > 0 ? age20_30 / total : 0;

    // 시간대별 중에서 가장 큰 값 찾아서 label 뽑기
    const slots = [
      { key: '00-06', value: Number(tm00_06) || 0 },
      { key: '06-11', value: Number(tm06_11) || 0 },
      { key: '11-14', value: Number(tm11_14) || 0 },
      { key: '14-17', value: Number(tm14_17) || 0 },
      { key: '17-21', value: Number(tm17_21) || 0 },
      { key: '21-24', value: Number(tm21_24) || 0 },
    ];

    let peakTimeSlot = '';
    let maxVal = -1;

    for (const s of slots) {
      if (s.value > maxVal) {
        maxVal = s.value;
        peakTimeSlot = s.key;
      }
    }

    return {
      period,
      totalFootfall: total,
      maleRatio,
      femaleRatio,
      age20_30Ratio,
      peakTimeSlot,
    };
  }
}