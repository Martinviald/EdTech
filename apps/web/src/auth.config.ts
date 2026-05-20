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
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = Boolean(auth?.user);
      const isOnDashboard = nextUrl.pathname.startsWith('/dashboard');
      if (isOnDashboard) return isLoggedIn;
      return true;
    },
  },
};
