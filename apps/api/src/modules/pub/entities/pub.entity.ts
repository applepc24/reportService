// src/modules/pub/entities/poi-pub.entity.ts
import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('poi_pub') // 실제 테이블 이름
export class PoiPub {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'dong_id' })
  dongId!: number; // FK지만 지금은 그냥 숫자로만 들고간다

  @Column()
  name!: string;

  @Column({ nullable: true })
  category?: string;

  @Column({ type: 'numeric', precision: 2, scale: 1, nullable: true })
  rating?: number; // 4.6 이런 값

  @Column({ name: 'review_count', default: 0 })
  reviewCount!: number;

  @Column({ name: 'price_tier', nullable: true })
  priceTier?: string; // 'low' | 'mid' | 'high' 이런 느낌
}