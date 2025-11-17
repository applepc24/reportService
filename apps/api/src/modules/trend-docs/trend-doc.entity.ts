import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "trend_docs" })
export class TrendDoc {
  @PrimaryGeneratedColumn()
  id!: number;

  // 나중에 "네이버 블로그", "인스타", "로컬 파일" 같은 출처 표시용
  @Column({ type: "text" })
  source!: string;

   // 🔹 네이버 검색용 상권 키워드 (성수동, 홍대입구 등)
  @Column({ nullable: true })
  area?: string;

  // 🔹 외부 문서의 고유 ID (네이버 블로그면 link 기반)
  @Column({ nullable: true, unique: true })
  externalId?: string;

  // 실제 텍스트 내용 (블로그 본문, 리뷰 등)
  @Column({ type: "text" })
  content!: string;

  // OpenAI 임베딩 벡터 (1536차원)
  // pgvector: vector(1536)
  @Column("vector", { length: 1536 })
  embedding!: string;
}