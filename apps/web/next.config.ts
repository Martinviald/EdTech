import type { NextConfig } from 'next';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

// El .env vive en la raíz del monorepo. Lo cargamos explícitamente porque
// Next.js solo lee .env relativo a apps/web/ por default.
loadEnv({ path: resolve(__dirname, '../../.env') });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@soe/ui', '@soe/types', '@soe/db'],
  // Oculta el indicador/botón flotante de desarrollo de Next (logo + estado de build).
  devIndicators: false,
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
