// src/modules/dong/dong.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Dong } from './entities/dong.entity';

@Injectable()
export class DongService {
  constructor(
    @InjectRepository(Dong)
    private readonly dongRepo: Repository<Dong>,
  ) {}

  // 전체 동 목록 (테스트용)
  findAll(): Promise<Dong[]> {
    return this.dongRepo.find({
      order: { id: 'ASC' },
      take: 50,
    });
  }

  // 이름 검색
  searchByName(keyword: string): Promise<Dong[]> {
    return this.dongRepo.find({
      where: { name: ILike(`%${keyword}%`) },
      take: 20,
    });
  }

  async findById(id: number): Promise<Dong | null> {
    return this.dongRepo.findOne({
      where: { id },
    });
  }
}