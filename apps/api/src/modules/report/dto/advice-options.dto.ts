// src/modules/report/dto/advice-options.dto.ts
import { IsOptional, IsString } from "class-validator";

export class AdviceOptionsDto {
  @IsString()
  budgetLevel!: string;

  @IsString()
  concept!: string;

  @IsString()
  targetAge!: string;

  @IsOptional()
  @IsString()
  openHours?: string;
}