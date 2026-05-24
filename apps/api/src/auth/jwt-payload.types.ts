/**
 * Claims que el AuthGuard extrae del JWT de NextAuth v5 y adjunta a `request.user`.
 * El token se genera en `apps/web/src/auth.ts` (callback `jwt`).
 *
 * `orgId` es null cuando el usuario es platform_admin sin membership de colegio:
 * los endpoints que operan sobre una org deben usar `getEffectiveOrgId(user, ?orgId)`
 * para resolver el target.
 */
export interface JwtPayload {
  userId: string;
  orgId: string | null;
  role: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
}
