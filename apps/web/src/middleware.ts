import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

// Re-exportamos `auth` de la config EDGE-SAFE (sin DB) — no del archivo
// `src/auth.ts` que importa Drizzle. Si se importara de ahí, el bundler
// intentaría empaquetar postgres-js para edge runtime y rompería el build.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ['/dashboard/:path*'],
};
