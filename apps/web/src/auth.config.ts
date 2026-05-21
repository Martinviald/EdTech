import type { NextAuthConfig } from 'next-auth';

/**
 * Config edge-safe de Auth.js. NO importar drizzle, postgres, ni @soe/db aquí:
 * el middleware corre en edge runtime y rompe el build si bundlea esos módulos.
 * Toda lógica con DB vive en src/auth.ts (Node runtime).
 */
export const authConfig: NextAuthConfig = {
  pages: {
    signIn: '/login',
    error: '/auth/error',
  },
  session: { strategy: 'jwt' },
  providers: [],
  callbacks: {
    authorized({ auth }) {
      // El matcher del middleware (src/middleware.ts) excluye rutas públicas
      // (`/`, `/login`, `/auth/*`, `/api/*`, `/styleguide`, assets). Cualquier
      // ruta que llegue aquí es privada y requiere sesión.
      return Boolean(auth?.user);
    },
  },
};
