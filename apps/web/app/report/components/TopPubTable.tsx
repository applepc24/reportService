// app/report/components/TopPubTable.tsx
import React from 'react';

export type ReportTopPub = {
    name: string;
    rating: number | null;
    reviewCount: number;
  };
  
  interface TopPubTableProps {
    pubs: ReportTopPub[];
  }
  
  export default function TopPubTable({ pubs }: TopPubTableProps) {
    if (!pubs.length) {
      return (
        <section
          style={{
            border: '1px solid #ddd',
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <h3 style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>
            상위 술집 TOP 리스트
          </h3>
          <div style={{ fontSize: 14, color: '#666' }}>데이터가 없습니다.</div>
        </section>
      );
    }
  
    return (
      <section
        style={{
          border: '1px solid #ddd',
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>
          상위 술집 TOP 리스트
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '4px 0', borderBottom: '1px solid #eee' }}>
                이름
              </th>
              <th style={{ textAlign: 'right', padding: '4px 0', borderBottom: '1px solid #eee' }}>
                평점
              </th>
              <th style={{ textAlign: 'right', padding: '4px 0', borderBottom: '1px solid #eee' }}>
                리뷰 수
              </th>
            </tr>
          </thead>
          <tbody>
            {pubs.map((pub, idx) => (
              <tr key={idx}>
                <td style={{ padding: '4px 0', borderBottom: '1px solid #f5f5f5' }}>
                  {pub.name}
                </td>
                <td
                  style={{
                    padding: '4px 0',
                    textAlign: 'right',
                    borderBottom: '1px solid #f5f5f5',
                  }}
                >
                  {pub.rating ?? 'N/A'}
                </td>
                <td
                  style={{
                    padding: '4px 0',
                    textAlign: 'right',
                    borderBottom: '1px solid #f5f5f5',
                  }}
                >
                  {pub.reviewCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }