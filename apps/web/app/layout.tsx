import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'PubInsight Seoul',
  description: '동네 술집 상권 리포트',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
          backgroundColor: '#0f172a',
          color: '#e5e7eb',
        }}
      >
        {children}
      </body>
    </html>
  );
}