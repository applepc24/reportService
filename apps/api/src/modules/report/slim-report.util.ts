// src/modules/report/slim-report.util.ts
import { ReportResponse, SalesTrendItem } from "./report.types";
import { SlimReport, SlimSalesTrendItem } from "./slim-report.types";

function toChangeIndex(
    v: any
  ): "LL" | "LH" | "HL" | "HH" | null {
    return v === "LL" || v === "LH" || v === "HL" || v === "HH" ? v : null;
  }

function calcLongTermDirection(series: SalesTrendItem[]) {
  if (!series || series.length < 2) return null;

  const vals = series.map(s => s.alcoholTotalAmt).filter(v => typeof v === "number");
  if (vals.length < 2) return null;

  const first = vals[0];
  const last = vals[vals.length - 1];
  const diff = last - first;

  const absFirst = Math.abs(first) || 1;
  const ratio = diff / absFirst;

  if (ratio > 0.1) return "up";
  if (ratio < -0.1) return "down";
  if (Math.abs(ratio) <= 0.05) return "flat";
  return "mixed";
}

export function toSlimReport(report: ReportResponse): SlimReport {
  const trend = report.salesTrend ?? [];

  // 최근 8개 분기만
  const recentRaw = trend.slice(-8);

  const recent: SlimSalesTrendItem[] = recentRaw.map(t => ({
    period: t.period,
    alcoholTotalAmt: t.alcoholTotalAmt,
    alcoholWeekendRatio: t.alcoholWeekendRatio ?? null,
    qoqGrowth: t.qoqGrowth ?? null,
    changeIndex: toChangeIndex(t.changeIndex),
    peakTimeSlot: t.peakTimeSlot ?? null,
  }));

  const qoqList = recentRaw
    .map(s => (typeof s.qoqGrowth === "number" ? s.qoqGrowth : null))
    .filter((v): v is number => v !== null);

  const recentQoqAvg =
    qoqList.length ? qoqList.reduce((a, b) => a + b, 0) / qoqList.length : null;

  const recentQoqVolatility =
    qoqList.length ? qoqList.reduce((a, b) => a + Math.abs(b), 0) / qoqList.length : null;

  // 연속 마이너스 streak
  let recentNegativeStreak = 0;
  for (const s of [...recentRaw].reverse()) {
    if (typeof s.qoqGrowth !== "number") break;
    if (s.qoqGrowth < 0) recentNegativeStreak++;
    else break;
  }

  return {
    dong: {
        id: report.dong.id,
        name: report.dong.name,
        code: report.dong.code ?? null,
      },
    summary: {
      pubCount: report.summary?.pubCount ?? 0,
    },
    traffic: report.traffic
      ? {
          totalFootfall: report.traffic.totalFootfall ?? null,
          maleRatio: report.traffic.maleRatio ?? null,
          femaleRatio: report.traffic.femaleRatio ?? null,
          age20_30Ratio: report.traffic.age20_30Ratio ?? null,
          peakTimeSlot: report.traffic.peakTimeSlot ?? null,
        }
      : null,
    store: report.store
      ? {
          totalStoreCount: report.store.totalStoreCount ?? null,
          openRate: report.store.openRate ?? null,
          closeRate: report.store.closeRate ?? null,
          franchiseRatio: report.store.franchiseRatio ?? null,
        }
      : null,
    sales: report.sales
      ? {
          period: report.sales.period,
          totalAmt: report.sales.totalAmt ?? null,
          weekendRatio: report.sales.weekendRatio ?? null,
          peakTimeSlot: report.sales.peakTimeSlot ?? null,
        }
      : null,
    taChange: report.taChange
      ? {
          period: report.taChange.period,
          index: report.taChange.index ?? null,
          indexName: report.taChange.indexName ?? null,
        }
      : null,
    facility: report.facility
      ? {
          viatrFacilityCount: report.facility.viatrFacilityCount ?? null,
          universityCount: report.facility.universityCount ?? null,
          subwayStationCount: report.facility.subwayStationCount ?? null,
          busStopCount: report.facility.busStopCount ?? null,
          bankCount: report.facility.bankCount ?? null,
        }
      : null,
    salesTrend: {
      recent,
      longTermDirection: calcLongTermDirection(trend),
      recentNegativeStreak,
      recentQoqAvg,
      recentQoqVolatility,
    },
    kakaoPubs: (report.kakaoPubs ?? []).slice(0, 5).map(p => ({
      name: p.name,
      category: p.category,
    })),
    risk: report.risk
      ? {
          level: report.risk.level,
          reasons: report.risk.reasons ?? [],
        }
      : null,
  };
}