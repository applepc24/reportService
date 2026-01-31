/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";

const nextConfig = {
  async rewrites() {
    // ✅ dev: 로컬 API로
    if (isDev) {
      return [
        {
          source: "/api/:path*",
          destination: "http://localhost:3000/:path*",
        },
      ];
    }

    // ✅ prod: api.snapreport.cloud로
    return [
      {
        source: "/api/:path*",
        destination: "https://api.snapreport.cloud/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
