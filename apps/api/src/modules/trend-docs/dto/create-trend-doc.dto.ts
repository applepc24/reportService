export class CreateTrendDocDto {
    source!: string;   // 어디서 온 문서인지 (예: "naver-blog", "instagram", "manual")
    content!: string;  // 실제 텍스트
  }