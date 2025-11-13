// src/modules/sale/entities/sales_metric.entity.ts
import { Column, Entity, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('sales_metrics')
@Index(['dongCode', 'period'])
export class SalesMetric {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ length: 10 })
  period!: string; // STDR_YYQU_CD

  @Column({ name: 'dong_code', length: 10 })
  dongCode!: string; // ADSTRD_CD

  @Column({ name: 'dong_name', length: 50 })
  dongName!: string; // ADSTRD_CD_NM

  @Column({ name: 'svc_code', length: 20 })
  svcCode!: string; // SVC_INDUTY_CD

  @Column({ name: 'svc_name', length: 100 })
  svcName!: string; // SVC_INDUTY_CD_NM

  // 금액 계열 (bigint → TypeORM에서 string으로 매핑됨)
  @Column({ name: 'thsmon_selng_amt', type: 'bigint', nullable: true })
  thsmonSelngAmt!: string | null;

  @Column({ name: 'mdwk_selng_amt', type: 'bigint', nullable: true })
  mdwkSelngAmt!: string | null;

  @Column({ name: 'wkend_selng_amt', type: 'bigint', nullable: true })
  wkendSelngAmt!: string | null;

  @Column({ name: 'mon_selng_amt', type: 'bigint', nullable: true })
  monSelngAmt!: string | null;

  @Column({ name: 'tues_selng_amt', type: 'bigint', nullable: true })
  tuesSelngAmt!: string | null;

  @Column({ name: 'wed_selng_amt', type: 'bigint', nullable: true })
  wedSelngAmt!: string | null;

  @Column({ name: 'thur_selng_amt', type: 'bigint', nullable: true })
  thurSelngAmt!: string | null;

  @Column({ name: 'fri_selng_amt', type: 'bigint', nullable: true })
  friSelngAmt!: string | null;

  @Column({ name: 'sat_selng_amt', type: 'bigint', nullable: true })
  satSelngAmt!: string | null;

  @Column({ name: 'sun_selng_amt', type: 'bigint', nullable: true })
  sunSelngAmt!: string | null;

  // ✅ 시간대 컬럼: 전부 소문자 snake_case 로 맞춤
  @Column({ name: 'tmzon_00_06_selng_amt', type: 'bigint', nullable: true })
  tm00_06Amt!: string | null;

  @Column({ name: 'tmzon_06_11_selng_amt', type: 'bigint', nullable: true })
  tm06_11Amt!: string | null;

  @Column({ name: 'tmzon_11_14_selng_amt', type: 'bigint', nullable: true })
  tm11_14Amt!: string | null;

  @Column({ name: 'tmzon_14_17_selng_amt', type: 'bigint', nullable: true })
  tm14_17Amt!: string | null;

  @Column({ name: 'tmzon_17_21_selng_amt', type: 'bigint', nullable: true })
  tm17_21Amt!: string | null;

  @Column({ name: 'tmzon_21_24_selng_amt', type: 'bigint', nullable: true })
  tm21_24Amt!: string | null;

  @Column({ name: 'male_selng_amt', type: 'bigint', default: 0 })
  maleSelngAmt!: string;
  @Column({ name: 'female_selng_amt', type: 'bigint', default: 0 })
  femaleSelngAmt!: string;

  @Column({ name: 'age10_selng_amt', type: 'bigint', default: 0 })
  age10SelngAmt!: string;
  @Column({ name: 'age20_selng_amt', type: 'bigint', default: 0 })
  age20SelngAmt!: string;
  @Column({ name: 'age30_selng_amt', type: 'bigint', default: 0 })
  age30SelngAmt!: string;
  @Column({ name: 'age40_selng_amt', type: 'bigint', default: 0 })
  age40SelngAmt!: string;
  @Column({ name: 'age50_selng_amt', type: 'bigint', default: 0 })
  age50SelngAmt!: string;
  @Column({ name: 'age60_selng_amt', type: 'bigint', default: 0 })
  age60SelngAmt!: string;

  // 건수
  @Column({ name: 'thsmon_selng_co', type: 'int', nullable: true })
  thsmonSelngCo!: number | null;

  @Column({ name: 'mdwk_selng_co', type: 'int', nullable: true })
  mdwkSelngCo!: number | null;

  @Column({ name: 'wkend_selng_co', type: 'int', nullable: true })
  wkendSelngCo!: number | null;
}