import type { NextConfig } from "next";

const WA_SERVER_URL = process.env.WA_SERVER_URL || "http://127.0.0.1:3001";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${WA_SERVER_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
