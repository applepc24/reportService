/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";

const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: isDev
          ? "http://localhost:3000/:path*"
          : "http://43.200.175.25:3000/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
