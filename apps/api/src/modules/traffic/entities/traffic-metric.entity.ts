// src/modules/traffic/entities/traffic-metric.entity.ts
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('traffic_metrics')
export class TrafficMetric {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'dong_code' })
  dongCode!: string;

  @Column({ name: 'dong_name' })
  dongName!: string;

  @Column()
  period!: string;

  @Column({ name: 'total_footfall', type: 'bigint', nullable: true })
  totalFootfall!: string | null;

  @Column({ name: 'male_footfall', type: 'bigint', nullable: true })
  maleFootfall!: string | null;

  @Column({ name: 'female_footfall', type: 'bigint', nullable: true })
  femaleFootfall!: string | null;

  @Column({ name: 'age_10', type: 'bigint', nullable: true })
  age10!: string | null;

  @Column({ name: 'age_20', type: 'bigint', nullable: true })
  age20!: string | null;

  @Column({ name: 'age_30', type: 'bigint', nullable: true })
  age30!: string | null;

  @Column({ name: 'age_40', type: 'bigint', nullable: true })
  age40!: string | null;

  @Column({ name: 'age_50', type: 'bigint', nullable: true })
  age50!: string | null;

  @Column({ name: 'age_60_plus', type: 'bigint', nullable: true })
  age60Plus!: string | null;

  @Column({ name: 'tm_00_06', type: 'bigint', nullable: true })
  tm00_06!: string | null;

  @Column({ name: 'tm_06_11', type: 'bigint', nullable: true })
  tm06_11!: string | null;

  @Column({ name: 'tm_11_14', type: 'bigint', nullable: true })
  tm11_14!: string | null;

  @Column({ name: 'tm_14_17', type: 'bigint', nullable: true })
  tm14_17!: string | null;

  @Column({ name: 'tm_17_21', type: 'bigint', nullable: true })
  tm17_21!: string | null;

  @Column({ name: 'tm_21_24', type: 'bigint', nullable: true })
  tm21_24!: string | null;

  @Column({ type: 'bigint', nullable: true })
  mon!: string | null;

  @Column({ type: 'bigint', nullable: true })
  tue!: string | null;

  @Column({ type: 'bigint', nullable: true })
  wed!: string | null;

  @Column({ type: 'bigint', nullable: true })
  thu!: string | null;

  @Column({ type: 'bigint', nullable: true })
  fri!: string | null;

  @Column({ type: 'bigint', nullable: true })
  sat!: string | null;

  @Column({ type: 'bigint', nullable: true })
  sun!: string | null;
}