// src/modules/kakao/kakao-local.service.ts
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';

export interface KakaoPlace {
  id: string;
  placeName: string;
  categoryName: string;
  placeUrl: string;
}

@Injectable()
export class KakaoLocalService {
  private readonly logger = new Logger(KakaoLocalService.name);
  private readonly baseUrl = 'https://dapi.kakao.com/v2/local';

  constructor(private readonly configService: ConfigService) {}

  private get apiKey(): string {
    const key = this.configService.get<string>('KAKAO_REST_API_KEY');
    if (!key) {
      throw new Error('KAKAO_REST_API_KEY is not set');
    }
    return key;
  }

  /**
   * 예: "연남동 술집" 이런 식으로 검색해서 상위 N개 가져오기
   */
  async searchPubsByDongName(
    dongName: string,
    options?: { size?: number },
  ): Promise<KakaoPlace[]> {
    const query = `${dongName} 술집`;
    const size = options?.size ?? 5;

    this.logger.log(`Kakao keyword search: "${query}" size=${size}`);

    const res = await axios.get(`${this.baseUrl}/search/keyword.json`, {
      headers: {
        Authorization: `KakaoAK ${this.apiKey}`,
      },
      params: {
        query,
        size,
        category_group_code: 'FD6', // 음식점 카테고리 안에서
      },
    });

    const docs = res.data?.documents ?? [];

    return docs.map((d: any) => ({
      id: d.id,
      placeName: d.place_name,
      categoryName: d.category_name,
      placeUrl: d.place_url,
    }));
  }

  async searchByDongAndKeyword(
    dongName: string,
    keyword: string,
    size = 5,
  ): Promise<KakaoPlace[]> {
    const query = keyword && keyword.trim().length > 0
      ? `${dongName} ${keyword}`
      : `${dongName} 술집`;

    this.logger.log(
      `Kakao dong+keyword search: "${query}" size=${size}`,
    );

    const res = await axios.get(`${this.baseUrl}/search/keyword.json`, {
      headers: {
        Authorization: `KakaoAK ${this.apiKey}`,
      },
      params: {
        query,
        size,
        category_group_code: 'FD6', // 음식점 안에서 검색
      },
    });

    const docs = res.data?.documents ?? [];

    return docs.map((d: any) => ({
      id: d.id,
      placeName: d.place_name,
      categoryName: d.category_name,
      placeUrl: d.place_url,
    }));
  }
}