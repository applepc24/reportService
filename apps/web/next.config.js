/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";

const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: isDev
          ? "http://localhost:3000/:path*"
          : "https://api.snapreport.cloud/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
