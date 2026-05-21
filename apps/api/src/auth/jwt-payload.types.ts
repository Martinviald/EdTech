/**
 * Claims que el AuthGuard extrae del JWT de NextAuth v5 y adjunta a `request.user`.
 * El token se genera en `apps/web/src/auth.ts` (callback `jwt`).
 */
export interface JwtPayload {
  userId: string;
  orgId: string;
  role: string;
  email: string;
  name: string;
}
