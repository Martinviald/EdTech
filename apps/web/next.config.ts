import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@soe/ui', '@soe/types'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
