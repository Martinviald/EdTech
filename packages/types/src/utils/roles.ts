import { ROLE_HIERARCHY, type UserRole } from '../enums';

export function userHasRole(roles: readonly UserRole[], role: UserRole): boolean {
  return roles.includes(role);
}

export function userHasAnyRole(
  roles: readonly UserRole[],
  allowed: readonly UserRole[],
): boolean {
  return roles.some((r) => allowed.includes(r));
}

// Alias semántico para chequeos de acceso desde la UI: "este usuario puede ver
// esta página/feature dado al menos uno de sus roles".
export function canAccess(
  roles: readonly UserRole[],
  allowed: readonly UserRole[],
): boolean {
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
