// app/page.tsx
'use client';

import React from 'react';
import Link from 'next/link';

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 'bold' }}>🍶 PubInsight Seoul</h1>
      <p style={{ fontSize: 14, color: '#9ca3af' }}>
        /report 페이지에서 동네 술집 리포트를 확인해 보세요.
      </p>
      <Link
        href="/report"
        style={{
          marginTop: 8,
          padding: '8px 16px',
          borderRadius: 999,
          backgroundColor: '#10b981',
          color: '#022c22',
          fontSize: 14,
          fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        리포트 보러가기 →
      </Link>
    </main>
  );
}