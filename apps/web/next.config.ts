import type { NextConfig } from 'next';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

// El .env vive en la raíz del monorepo. Lo cargamos explícitamente porque
// Next.js solo lee .env relativo a apps/web/ por default.
loadEnv({ path: resolve(__dirname, '../../.env') });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@soe/types', '@soe/db'],
  // Oculta el indicador/botón flotante de desarrollo de Next (logo + estado de build).
  devIndicators: false,
  // typedRoutes desactivado: sus tipos RouteImpl solo se generan en `next build`
  // (no en `pnpm typecheck`), y rechazan rutas con query string (`?...`) que en
  // runtime funcionan bien. Bloqueaba el build de producción del demo.
  // (En Next 15.5 salió de `experimental` y es una clave top-level.)
  typedRoutes: false,
};

export default nextConfig;
