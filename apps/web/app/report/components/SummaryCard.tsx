// app/report/components/SummaryCard.tsx
import React from 'react';

export type ReportSummary = {
    pubCount: number;
    avgRating: number | null;
    reviews: number;
  };
  
  interface SummaryCardProps {
    dongName: string;
    summary: ReportSummary;
  }
  
  export default function SummaryCard({ dongName, summary }: SummaryCardProps) {
    return (
      <section
        style={{
          border: '1px solid #ddd',
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 8 }}>
          {dongName} 리포트 요약
        </h2>
        <div style={{ display: 'flex', gap: 24 }}>
          <div>
            <div style={{ color: '#666', fontSize: 12 }}>술집 수</div>
            <div style={{ fontSize: 20, fontWeight: 'bold' }}>
              {summary.pubCount}
            </div>
          </div>
          <div>
            <div style={{ color: '#666', fontSize: 12 }}>평균 평점</div>
            <div style={{ fontSize: 20, fontWeight: 'bold' }}>
              {summary.avgRating ?? 'N/A'}
            </div>
          </div>
          <div>
            <div style={{ color: '#666', fontSize: 12 }}>리뷰 수</div>
            <div style={{ fontSize: 20, fontWeight: 'bold' }}>
              {summary.reviews}
            </div>
          </div>
        </div>
      </section>
    );
  }