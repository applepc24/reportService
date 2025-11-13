// src/modules/ta-change/entities/ta_change_metric.entity.ts
import { Column, Entity, PrimaryGeneratedColumn, Index } from "typeorm";

@Entity("ta_change_metrics")
@Index(["dongCode", "period"])
export class TAChangeMetric {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ length: 10 })
  period!: string; // STDR_YYQU_CD (예: '20251')

  @Column({ length: 10 })
  dongCode!: string; // ADSTRD_CD

  @Column({ length: 50 })
  dongName!: string; // ADSTRD_CD_NM

  // ✅ 문자열 코드(LL/LH/HL/HH). null 허용 & 초기값 제공해 TS2564 해소
  @Column({ name: 'changeIndex', type: 'varchar', length: 4, nullable: true })
  changeIndex: 'LL' | 'LH' | 'HL' | 'HH' | null = null;
  
  @Column({ name: 'changeIndexName', type: 'varchar', length: 20, nullable: true })
  changeIndexName: string | null = null;

  @Column("int", { nullable: true })
  opRunMonthAvg!: number | null; // OPR_SALE_MT_AVRG

  @Column("int", { nullable: true })
  clRunMonthAvg!: number | null; // CLS_SALE_MT_AVRG

  @Column("int", { nullable: true })
  seoulOpRunMonthAvg!: number | null; // SU_OPR_SALE_MT_AVRG

  @Column("int", { nullable: true })
  seoulClRunMonthAvg!: number | null; // SU_CLS_SALE_MT_AVRG
}
