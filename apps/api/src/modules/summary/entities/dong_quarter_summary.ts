// src/modules/summary/entities/dong_quarter_summary.entity.ts
import { ViewEntity, ViewColumn } from 'typeorm';

@ViewEntity({
  name: 'mv_dong_quarter',
  synchronize: false, // DB에서 이미 만들어졌으니 건드리지 않게
})
export class DongQuarterSummary {
  @ViewColumn()
  period!: string;

  @ViewColumn()
  dongCode!: string;

  @ViewColumn()
  dongName!: string;

  @ViewColumn()
  alcoholTotalAmt!: string;    // bigint라 string으로 옴
  @ViewColumn()
  alcoholWeekendAmt!: string;
  @ViewColumn()
  alcoholWeekendRatio!: number;

  @ViewColumn()
  maleAmt!: string;
  @ViewColumn()
  femaleAmt!: string;

  @ViewColumn()
  age10Amt!: string;
  @ViewColumn()
  age20Amt!: string;
  @ViewColumn()
  age30Amt!: string;
  @ViewColumn()
  age40Amt!: string;
  @ViewColumn()
  age50Amt!: string;
  @ViewColumn()
  age60PlusAmt!: string;

  @ViewColumn()
  tm00_06Amt!: string;
  @ViewColumn()
  tm06_11Amt!: string;
  @ViewColumn()
  tm11_14Amt!: string;
  @ViewColumn()
  tm14_17Amt!: string;
  @ViewColumn()
  tm17_21Amt!: string;
  @ViewColumn()
  tm21_24Amt!: string;

  @ViewColumn()
  changeIndex!: string | null;
  @ViewColumn()
  changeIndexName!: string | null;
  @ViewColumn()
  opRunMonthAvg!: number | null;
  @ViewColumn()
  clRunMonthAvg!: number | null;
  @ViewColumn()
  seoulOpRunMonthAvg!: number | null;
  @ViewColumn()
  seoulClRunMonthAvg!: number | null;

  @ViewColumn()
  viatrFacilityCount!: number | null;
  @ViewColumn()
  universityCount!: number | null;
  @ViewColumn()
  subwayStationCount!: number | null;
  @ViewColumn()
  busStopCount!: number | null;
  @ViewColumn()
  bankCount!: number | null;
}