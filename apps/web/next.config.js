/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://43.200.175.25:3000/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
