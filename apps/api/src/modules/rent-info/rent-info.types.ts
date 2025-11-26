// apps/api/src/modules/rent-info/rent-info.types.ts

export type RentInfoSummary = {
    dongName: string;
    sampleCount: number;
    minPrice: number | null;
    maxPrice: number | null;
  
    // ✅ 매매 실거래 (거래금액(만원) / 면적(㎡)) 평균
    avgTradePricePerM2Manwon: number | null;
  
    // (선택) 필요하면 같이 제공
    avgTradePricePerM2Won: number | null;
  
    recentContractDate: string | null;
  
    p25PricePerM2: number | null;
    p50PricePerM2: number | null;
    p75PricePerM2: number | null;
    avgTotalPrice: number | null;
  };