import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Edge-level redirect — runs on Vercel's CDN, no serverless function cold start
  async redirects() {
    return [
      {
        source: '/',
        destination: '/login',
        permanent: false, // 307 — cacheable by browser but not proxies
      },
    ];
  },
};

export default nextConfig;
