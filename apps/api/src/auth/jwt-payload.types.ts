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
 *
 * Multi-org: `orgs` lista todas las orgs a las que pertenece el usuario (para
 * el selector). `orgId`/`orgName`/`roles`/`activeRole` reflejan SIEMPRE la org
 * activa; al cambiar de org, el backend recalcula roles/activeRole para la org
 * destino. `orgs` está vacío para platform_admin sin membership de colegio.
 */
export interface JwtPayload {
  userId: string;
  orgId: string | null;
  /**
   * Org activa + todas las orgs del usuario. El AuthGuard siempre las popula en
   * runtime (array vacío si no aplica); son opcionales en el tipo sólo para no
   * obligar a cada factory de test a declararlas.
   */
  orgName?: string | null;
  orgs?: Array<{ id: string; name: string }>;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
  roles: UserRole[];
  activeRole: UserRole;
  /** @deprecated mirror de activeRole durante la migración multi-rol. */
  role: UserRole;
}
