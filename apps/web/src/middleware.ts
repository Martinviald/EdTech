import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

// Re-exportamos `auth` de la config EDGE-SAFE (sin DB) — no del archivo
// `src/auth.ts` que importa Drizzle. Si se importara de ahí, el bundler
// intentaría empaquetar postgres-js para edge runtime y rompería el build.
export const { auth: middleware } = NextAuth(authConfig);

// Matcher negado: protege TODAS las rutas excepto la home pública (/),
// /login, /auth/*, /api/*, /styleguide (acceso del equipo de diseño),
// archivos estáticos de Next y assets con extensión.
export const config = {
  matcher: ['/((?!$|login|auth|api|styleguide|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
