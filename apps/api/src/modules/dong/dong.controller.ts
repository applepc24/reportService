// src/modules/dong/dong.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { DongService } from './dong.service';
import { Dong } from './entities/dong.entity';

@Controller('dong')
export class DongController {
  constructor(private readonly dongService: DongService) {}

  // GET /dong
  @Get()
  getAll(): Promise<Dong[]> {
    return this.dongService.findAll();
  }

  // GET /dong/search?q=연남
  @Get("search")
  async search(@Query("q") q: string) {
    const rows = await this.dongService.searchByName(q);

    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      // 여기 컬럼명은 실제 엔티티에 맞춰서(예시)
      code: d.code,
    }));
  }
}