import { IsNumber, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { AdviceOptionsDto } from "./advice-options.dto";

export class AdviceRequestDto {
  @IsNumber()
  dongId!: number;

  @ValidateNested()
  @Type(() => AdviceOptionsDto)
  options!: AdviceOptionsDto;

  @IsOptional()
  @IsString()
  question?: string;
}