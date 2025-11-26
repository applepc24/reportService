import { Controller, Get, Query, Logger } from "@nestjs/common";
import { RentInfoService } from "./rent-info.service";

@Controller("rent-info")
export class RentInfoController {
  private readonly logger = new Logger(RentInfoController.name);
  constructor(private readonly rentInfoService: RentInfoService) {}

  @Get("summary")
  async getSummary(@Query("dongName") dongName: string) {
    this.logger.log(`GET /rent-info/summary dongName=${dongName}`);
    const summary = await this.rentInfoService.getSummaryByDongName(dongName);
    dongName = dongName.replace(/"/g, "").trim();
    return {
      ok: true,
      dongName,
      summary,
    };
  }
}
