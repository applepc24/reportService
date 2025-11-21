// apps/api/src/modules/trend-docs/trend-rerank.util.ts
import { TrendDocSearchResult } from "./trend-docs.service";

export interface RerankOptions {
  areaKeyword?: string;        // ex) "영등포동"
  keywords?: string[];         // ex) ["힙한", "맥주집", "소주집"]
  topN?: number;               // 최종 반환 개수
}

export function rerankHybrid(
  docs: TrendDocSearchResult[],
  opts: RerankOptions
): TrendDocSearchResult[] {
  const area = (opts.areaKeyword ?? "").trim();
  const keywords = opts.keywords ?? [];
  const topN = opts.topN ?? 5;

  const scored = docs.map((d) => {
    const content = (d.content ?? "").toLowerCase();
    const areaDoc = (d as any).area ?? ""; // search 쿼리에서 area도 같이 가져오면 더 좋음

    // 1) vector similarity
    const simVec = 1 / (1 + (d.distance ?? 0));

    // 2) lexical score
    let lex = 0;
    for (const kw of keywords) {
      if (kw && content.includes(kw.toLowerCase())) lex += 0.15;
    }

    // 3) area boost
    if (area) {
      if (content.includes(area.toLowerCase())) lex += 0.4;
      if (areaDoc && areaDoc === area) lex += 0.6;
      if (content.includes("서울")) lex += 0.1;
    }

    const score = simVec + lex;
    return { ...d, _score: score };
  });

  scored.sort((a: any, b: any) => b._score - a._score);
  return scored.slice(0, topN);
}