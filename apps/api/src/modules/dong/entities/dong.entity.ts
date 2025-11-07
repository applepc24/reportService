import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('dong') // ✅ 실제 테이블 이름
export class Dong {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column({ nullable: true })
  code?: string;
}