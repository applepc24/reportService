/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";

const nextConfig = {
  async rewrites() {
    // dev에서만 /api 프록시 사용 (로컬 개발 편의)
    if (isDev) {
      return [
        {
          source: "/api/:path*",
          destination: "http://localhost:3000/:path*",
        },
      ];
    }

    // production에서는 /api 프록시를 끈다 (Vercel 502 방지)
    return [];
  },
};

module.exports = nextConfig;
