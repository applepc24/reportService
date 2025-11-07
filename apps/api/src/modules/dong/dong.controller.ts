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
  @Get('search')
  search(@Query('q') q?: string): Promise<Dong[]> {
    if (!q) {
      return this.dongService.findAll();
    }
    return this.dongService.searchByName(q);
  }
}