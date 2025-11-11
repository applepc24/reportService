// apps/api/src/modules/kakao/kakao-local.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface KakaoPlaceSimple {
  name: string;
  category: string;
  url: string;
}

@Injectable()
export class KakaoLocalService {
  private readonly logger = new Logger(KakaoLocalService.name);
  private readonly baseUrl = 'https://dapi.kakao.com/v2/local';

  constructor(private readonly configService: ConfigService) {}

  /** env 에서 Kakao REST API 키 꺼내오기 */
  private get apiKey(): string {
    const key = this.configService.get<string>('KAKAO_REST_API_KEY');
    if (!key) {
      throw new Error('KAKAO_REST_API_KEY is not set');
    }
    return key;
  }

  /**
   * 🔹 기본 키워드 검색
   * 예: "연남동 술집"
   */
  async searchByKeyword(
    query: string,
    size = 5,
  ): Promise<KakaoPlaceSimple[]> {
    const url = `${this.baseUrl}/search/keyword.json`;

    this.logger.log(`Kakao keyword search: "${query}", size=${size}`);

    const res = await axios.get(url, {
      headers: {
        Authorization: `KakaoAK ${this.apiKey}`,
      },
      params: {
        query,
        size,
      },
    });

    const docs = res.data?.documents ?? [];

    return docs.map((doc: any) => ({
      name: doc.place_name,
      category: doc.category_name,
      url: doc.place_url,
    }));
  }

  /**
   * 🔹 우리 서비스용 헬퍼:
   *    "동 이름 + 카테고리 키워드" 조합으로 검색
   *    예: (연남동, 술집) → "연남동 술집"
   */
  async searchByDongAndKeyword(
    dongName: string,
    categoryKeyword: string,
    size = 5,
  ): Promise<KakaoPlaceSimple[]> {
    const keyword = `${dongName} ${categoryKeyword}`;
    return this.searchByKeyword(keyword, size);
  }
}