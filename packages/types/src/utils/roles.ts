import { ROLE_HIERARCHY, type UserRole } from '../enums';

export function userHasRole(roles: readonly UserRole[], role: UserRole): boolean {
  return roles.includes(role);
}

export function userHasAnyRole(roles: readonly UserRole[], allowed: readonly UserRole[]): boolean {
  return roles.some((r) => allowed.includes(r));
}

// Alias semántico para chequeos de acceso desde la UI: "este usuario puede ver
// esta página/feature dado al menos uno de sus roles".
export function canAccess(roles: readonly UserRole[], allowed: readonly UserRole[]): boolean {
  return userHasAnyRole(roles, allowed);
}

// Devuelve el rol de mayor jerarquía presente. Lanza si recibe array vacío:
// la función asume que el caller ya validó que el usuario tiene al menos un
// rol asignado (de lo contrario no debería haber sesión).
export function pickDefaultActiveRole(roles: readonly UserRole[]): UserRole {
  if (roles.length === 0) {
    throw new Error('pickDefaultActiveRole: roles array está vacío');
  }
  for (const candidate of ROLE_HIERARCHY) {
    if (roles.includes(candidate)) return candidate;
  }
  return roles[0] as UserRole;
}

// Rank de una org = índice del mejor (más alto) rol que el usuario tiene en
// ella dentro de ROLE_HIERARCHY. Menor índice = mayor privilegio. Roles fuera
// de la jerarquía (no debería ocurrir) se tratan como el menos privilegiado.
function orgRank(memberships: readonly { role: UserRole }[]): number {
  let best = Number.MAX_SAFE_INTEGER;
  for (const m of memberships) {
    const idx = ROLE_HIERARCHY.indexOf(m.role);
    const rank = idx === -1 ? ROLE_HIERARCHY.length : idx;
    if (rank < best) best = rank;
  }
  return best;
}

// Elige la org por defecto tras el login para un usuario multi-org: aquella
// donde tiene el rol de mayor jerarquía (ej. school_admin > teacher), con
// tiebreak alfabético por nombre para que sea determinista. Lanza si el array
// está vacío (un usuario con sesión siempre tiene al menos una org).
export function pickDefaultActiveOrg<
  T extends { organization: { name: string }; memberships: readonly { role: UserRole }[] },
>(orgs: readonly T[]): T {
  if (orgs.length === 0) {
    throw new Error('pickDefaultActiveOrg: orgs array está vacío');
  }
  return [...orgs].sort((a, b) => {
    const rankDiff = orgRank(a.memberships) - orgRank(b.memberships);
    if (rankDiff !== 0) return rankDiff;
    return a.organization.name.localeCompare(b.organization.name);
  })[0] as T;
}
