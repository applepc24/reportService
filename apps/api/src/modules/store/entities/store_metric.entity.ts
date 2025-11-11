// apps/api/src/modules/store/entities/store-metric.entity.ts
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('store_metrics')
@Index(['period', 'dongCode'])
@Index(['period', 'dongCode', 'serviceCode'])
export class StoreMetric {
  @PrimaryGeneratedColumn()
  id!: number;

  // 기준 분기 (예: 20241)
  @Column({ length: 5 })
  period!: string;

  // 행정동 코드 (예: 11440730)
  @Column({ length: 10 })
  dongCode!: string;

  // 행정동 이름 (예: 연남동)
  @Column({ length: 50 })
  dongName!: string;

  // 서비스 업종 코드 (예: CS100009)
  @Column({ length: 20 })
  serviceCode!: string;

  // 서비스 업종 이름 (예: 호프-간이주점)
  @Column({ length: 100 })
  serviceName!: string;

  // 점포 수
  @Column('int')
  storeCount!: number;

  // 유사 업종 점포 수
  @Column('int')
  similarStoreCount!: number;

  // 창업 비율(%)
  @Column('int')
  openRate!: number;

  // 창업 점포 수
  @Column('int')
  openStoreCount!: number;

  // 폐업 비율(%)
  @Column('int')
  closeRate!: number;

  // 폐업 점포 수
  @Column('int')
  closeStoreCount!: number;

  // 프랜차이즈 점포 수
  @Column('int')
  franchiseStoreCount!: number;
}