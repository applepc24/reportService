// apps/api/src/modules/rent-info/rent-info.module.ts
import { Module } from "@nestjs/common";
import { RentInfoService } from "./rent-info.service";
import { RentInfoController } from "./rent-info.controller";

@Module({
  providers: [RentInfoService],
  controllers: [RentInfoController],
  exports: [RentInfoService], // ReportService 등에서 쓰려고 외부로 export
})
export class RentInfoModule {}