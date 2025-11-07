// src/modules/review/entities/review.entity.ts
import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('review')
export class Review {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'poi_id' })
  poiId!: number;

  @Column({ nullable: true })
  rating?: number;

  @Column({ type: 'date', nullable: true })
  date?: string; // Date로 해도 되는데 string으로 써도 됨

  @Column({ type: 'text', nullable: true })
  text?: string;
}