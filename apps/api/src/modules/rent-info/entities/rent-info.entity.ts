// apps/api/src/modules/rent-info/entities/rent-info.entity.ts
import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("rent_info")
@Index(["sido", "sigungu"])
@Index(["sigungu", "emdNameBase"])
export class RentInfo {
  @PrimaryGeneratedColumn()
  id!: number;

  // 시/도 (예: 서울특별시)
  @Column({ length: 50 })
  sido!: string;

  // 시/군/구 (예: 서초구, 용산구, 중구)
  @Column({ length: 50 })
  sigungu!: string;

  // 원본 동/가 이름 전체 (예: 방배동, 한강로2가, 영등포동3가)
  @Column({ name: "emd_name_raw", length: 100, nullable: true })
  emdNameRaw!: string | null;

  // 매핑/검색용 base 이름 (예: 방배동, 영등포동)
  @Column({ name: "emd_name_base", length: 100, nullable: true })
  emdNameBase!: string | null;

  // 지번 (예: 1002-3)
  @Column({ length: 50, nullable: true })
  jibun!: string | null;

  // 도로명 (예: 명달로, 장충단로)
  @Column({ name: "road_name", length: 100, nullable: true })
  roadName!: string | null;

  // 용도지역 (예: 일반상업, 제2종일반주거)
  @Column({ name: "land_use", length: 50, nullable: true })
  landUse!: string | null;

  // 건축물 주용도 (예: 제1종근린생활, 판매, 업무)
  @Column({ name: "building_main_use", length: 50, nullable: true })
  buildingMainUse!: string | null;

  // 도로 조건 (예: 12m미만, 25m이상)
  @Column({ name: "road_width_type", length: 50, nullable: true })
  roadWidthType!: string | null;

  // 전용/연면적(㎡)
  @Column({ name: "area_m2", type: "float", nullable: true })
  areaM2!: number | null;

  // 대지면적(㎡)
  @Column({ name: "land_area_m2", type: "float", nullable: true })
  landAreaM2!: number | null;

  // 거래금액(만원)
  @Column({ name: "price_manwon", type: "int" })
  priceManwon!: number;

  // 층 (숫자가 아닌 값도 있을 수 있어서 string으로)
  @Column({ length: 20, nullable: true })
  floor!: string | null;

  // 매수 주체 (예: 개인, 법인)
  @Column({ name: "buyer_type", length: 20, nullable: true })
  buyerType!: string | null;

  // 매도 주체 (예: 개인, 법인)
  @Column({ name: "seller_type", length: 20, nullable: true })
  sellerType!: string | null;

  // 계약년월 (예: 202511)
  @Column({ name: "contract_yyyymm", length: 6 })
  contractYyyymm!: string;

  // 계약일 (예: 24, 25 등)
  @Column({ name: "contract_day", type: "int", nullable: true })
  contractDay!: number | null;

  // 지분구분
  @Column({ name: "share_type", length: 50, nullable: true })
  shareType!: string | null;

  // 건축년도
  @Column({ name: "build_year", type: "int", nullable: true })
  buildYear!: number | null;

  // 해제사유발생일 (문자 그대로 보관)
  @Column({ name: "cancel_date_raw", length: 20, nullable: true })
  cancelDateRaw!: string | null;

  // 거래유형 (중개거래 / 직거래 등)
  @Column({ name: "trade_type", length: 20, nullable: true })
  tradeType!: string | null;

  // 중개사 소재지
  @Column({ name: "broker_location", length: 100, nullable: true })
  brokerLocation!: string | null;
}