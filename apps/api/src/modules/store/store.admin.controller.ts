// apps/api/src/modules/store/store.admin.controller.ts
import { BadRequestException, Controller, Post, Query } from "@nestjs/common";
import { StoreService } from "./store.service";
import { ConfigService } from "@nestjs/config";

@Controller("admin/store")
export class StoreAdminController {
  constructor(
    private readonly storeService: StoreService,
    private readonly configService: ConfigService
  ) {}

  @Post("import")
  async importQuarter(
    @Query("period") period: string,
    @Query("apiKey") apiKeyFromQuery?: string
  ) {
    // 1) 쿼리스트링에 apiKey가 있으면 그거 우선 사용
    // 2) 없으면 env(SEOUL_API_KEY)에서 가져오기
    const apiKey =
      apiKeyFromQuery ?? this.configService.get<string>("SEOUL_API_KEY");

    if (!apiKey) {
      throw new BadRequestException(
        "서울 API 키가 없습니다. ?apiKey=... 쿼리로 보내거나 SEOUL_API_KEY env를 설정하세요."
      );
    }

    if (!period) {
      throw new BadRequestException(
        "period 쿼리 파라미터가 필요합니다. 예: 20241"
      );
    }

    const inserted = await this.storeService.importQuarter(apiKey, period);
    return { period, inserted };
  }
}
