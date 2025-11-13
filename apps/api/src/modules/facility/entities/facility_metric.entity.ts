import { Column, Entity, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('facility_metrics')
@Index(['dongCode', 'period'])
export class FacilityMetric {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ length: 10 })
  period!: string;

  @Column({ name: 'dong_code', length: 10 })
  dongCode!: string;

  @Column({ name: 'dong_name', length: 50 })
  dongName!: string;

  @Column({ name: 'viatr_facility_count', type: 'int', nullable: true })
  viatrFacilityCount!: number | null;

  @Column({ name: 'public_office_count', type: 'int', nullable: true })
  publicOfficeCount!: number | null;

  @Column({ name: 'bank_count', type: 'int', nullable: true })
  bankCount!: number | null;

  @Column({ name: 'general_hospital_count', type: 'int', nullable: true })
  generalHospitalCount!: number | null;

  @Column({ name: 'pharmacy_count', type: 'int', nullable: true })
  pharmacyCount!: number | null;

  @Column({ name: 'kindergarten_count', type: 'int', nullable: true })
  kindergartenCount!: number | null;

  @Column({ name: 'elementary_school_count', type: 'int', nullable: true })
  elementarySchoolCount!: number | null;

  @Column({ name: 'middle_school_count', type: 'int', nullable: true })
  middleSchoolCount!: number | null;

  @Column({ name: 'high_school_count', type: 'int', nullable: true })
  highSchoolCount!: number | null;

  @Column({ name: 'university_count', type: 'int', nullable: true })
  universityCount!: number | null;

  @Column({ name: 'supermarket_count', type: 'int', nullable: true })
  supermarketCount!: number | null;

  @Column({ name: 'theater_count', type: 'int', nullable: true })
  theaterCount!: number | null;

  @Column({ name: 'lodging_count', type: 'int', nullable: true })
  lodgingCount!: number | null;

  @Column({ name: 'airport_count', type: 'int', nullable: true })
  airportCount!: number | null;

  @Column({ name: 'railroad_station_count', type: 'int', nullable: true })
  railroadStationCount!: number | null;

  @Column({ name: 'bus_terminal_count', type: 'int', nullable: true })
  busTerminalCount!: number | null;

  @Column({ name: 'subway_station_count', type: 'int', nullable: true })
  subwayStationCount!: number | null;

  @Column({ name: 'bus_stop_count', type: 'int', nullable: true })
  busStopCount!: number | null;
}