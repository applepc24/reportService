// apps/api/src/modules/store/store.service.ts
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreMetric } from './entities/store_metric.entity';

export interface StoreSummary {
  dongCode: string;
  totalStoreCount: number;
  openStoreCount: number;
  closeStoreCount: number;
  franchiseStoreCount: number;
  openRate: number;        // 0~1
  closeRate: number;       // 0~1
  franchiseRatio: number;  // 0~1
}


@Injectable()
export class StoreService {
  private readonly logger = new Logger(StoreService.name);
  private readonly baseUrl = 'http://openapi.seoul.go.kr:8088';
  private readonly serviceName = 'VwsmAdstrdStorW'; // 점포-행정동

  constructor(
    @InjectRepository(StoreMetric)
    private readonly storeRepo: Repository<StoreMetric>,
  ) {}

  /**
   * 특정 분기(period, 예: '20241')의
   * "점포-행정동" 데이터를 페이지네이션 돌면서 전부 가져와서
   * 그 중 술집 관련 업종만 DB에 저장
   */
  async importQuarter(apiKey: string, period: string): Promise<number> {
    const pageSize = 1000;
    let start = 1;
    let totalInserted = 0;

    this.logger.log(`Start importing store data for period=${period}`);

    while (true) {
      const end = start + pageSize - 1;
      const url = `${this.baseUrl}/${apiKey}/json/${this.serviceName}/${start}/${end}/${period}`;

      this.logger.log(`Fetching store data: ${url}`);
      const res = await axios.get(url);

      const svc = res.data?.[this.serviceName];
      if (!svc) {
        this.logger.error(`No ${this.serviceName} field in response`);
        break;
      }

      const rows = svc.row ?? [];
      this.logger.log(
        `Got ${rows.length} rows (start=${start}, end=${end}) from API`,
      );

      if (rows.length === 0) {
        // 더 이상 데이터 없음 → 종료
        break;
      }

      let insertedThisPage = 0;

      for (const r of rows) {
        const svcName: string = String(r.SVC_INDUTY_CD_NM ?? '');

        // 🔸 술집 관련 업종만 필터 (일단 계속 유지)
        const isAlcohol =
          svcName.includes('호프') ||
          svcName.includes('주점') ||
          svcName.includes('술집') ||
          svcName.includes('와인') ||
          svcName.includes('바');

        if (!isAlcohol) {
          continue;
        }

        const entity = this.storeRepo.create({
          period: String(r.STDR_YYQU_CD),
          dongCode: String(r.ADSTRD_CD),
          dongName: String(r.ADSTRD_CD_NM),
          serviceCode: String(r.SVC_INDUTY_CD),
          serviceName: svcName,

          storeCount: Number(r.STOR_CO ?? 0),
          similarStoreCount: Number(r.SIMILR_INDUTY_STOR_CO ?? 0),
          openRate: Number(r.OPBIZ_RT ?? 0),
          openStoreCount: Number(r.OPBIZ_STOR_CO ?? 0),
          closeRate: Number(r.CLSBIZ_RT ?? 0),
          closeStoreCount: Number(r.CLSBIZ_STOR_CO ?? 0),
          franchiseStoreCount: Number(r.FRC_STOR_CO ?? 0),
        });

        await this.storeRepo.save(entity);
        insertedThisPage++;
        totalInserted++;
      }

      this.logger.log(
        `✅ inserted ${insertedThisPage} store rows for this page (start=${start})`,
      );

      // 마지막 페이지면 종료 (1000개보다 적게 왔다는 건 끝까지 온 것)
      if (rows.length < pageSize) {
        break;
      }

      // 다음 페이지로
      start += pageSize;
    }

    this.logger.log(
      `✅ Done importing store rows for period=${period}, totalInserted=${totalInserted}`,
    );
    return totalInserted;
  }

  async getAlcoholSummaryByDongCode(
    dongCode: string,
  ): Promise<StoreSummary | null> {
    // 가장 최신 period 하나 찾기
    const latest = await this.storeRepo.findOne({
      where: { dongCode },
      order: {
        period: 'DESC',
        id: 'DESC',
      },
    });

    if (!latest) {
      return null;
    }

    const period = latest.period;

    // 해당 period + dongCode 에 대해 전체 합계 계산
    const row = await this.storeRepo
      .createQueryBuilder('s')
      .select('SUM(s.storeCount)', 'totalStoreCount')
      .addSelect('SUM(s.openStoreCount)', 'openStoreCount')
      .addSelect('SUM(s.closeStoreCount)', 'closeStoreCount')
      .addSelect('SUM(s.franchiseStoreCount)', 'franchiseStoreCount')
      .where('s.dongCode = :dongCode', { dongCode })
      .andWhere('s.period = :period', { period })
      .getRawOne<{
        totalStoreCount: string | null;
        openStoreCount: string | null;
        closeStoreCount: string | null;
        franchiseStoreCount: string | null;
      }>();

    if (!row || row.totalStoreCount === null) {
      return null;
    }

    const total = Number(row.totalStoreCount) || 0;
    const open = Number(row.openStoreCount) || 0;
    const close = Number(row.closeStoreCount) || 0;
    const franchise = Number(row.franchiseStoreCount) || 0;

    return {
      dongCode,
      totalStoreCount: total,
      openStoreCount: open,
      closeStoreCount: close,
      franchiseStoreCount: franchise,
      openRate: total > 0 ? open / total : 0,
      closeRate: total > 0 ? close / total : 0,
      franchiseRatio: total > 0 ? franchise / total : 0,
    };
  }
}