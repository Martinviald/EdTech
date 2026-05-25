import type { UserRole } from '@soe/types';

/**
 * Claims que el AuthGuard extrae del JWT de NextAuth v5 y adjunta a `request.user`.
 * El token se genera en `apps/web/src/auth.ts` (callback `jwt`).
 *
 * `orgId` es null cuando el usuario es platform_admin sin membership de colegio:
 * los endpoints que operan sobre una org deben usar `getEffectiveOrgId(user, ?orgId)`
 * para resolver el target.
 *
 * Multi-rol: `roles` contiene todos los memberships activos del usuario en su
 * org. `activeRole` es el rol elegido vía el selector (default = mayor
 * jerarquía). Los guards autorizan por unión (`roles`) salvo excepciones
 * puntuales documentadas (ej. ClassGroupsService.isTeacherView).
 */
export interface JwtPayload {
  userId: string;
  orgId: string | null;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
  roles: UserRole[];
  activeRole: UserRole;
  /** @deprecated mirror de activeRole durante la migración multi-rol. */
  role: UserRole;
}
