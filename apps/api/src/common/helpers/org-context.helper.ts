import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { JwtPayload } from '../../auth/jwt-payload.types';

/**
 * Resuelve el orgId target de una operación a partir del JWT del caller y un orgId solicitado.
 *
 * Reglas:
 *  - platform_admin sin orgId solicitado → 400 (debe ser explícito).
 *  - platform_admin con orgId solicitado → pasa.
 *  - usuario normal: si requestedOrgId difiere de user.orgId → 403.
 *  - usuario normal sin orgId en JWT → 403 (estado inválido).
 */
export function getEffectiveOrgId(user: JwtPayload, requestedOrgId?: string | null): string {
  if (user.isPlatformAdmin) {
    if (!requestedOrgId) {
      throw new BadRequestException(
        'Platform admin debe especificar la organización destino explícitamente',
      );
    }
    return requestedOrgId;
  }

  if (!user.orgId) {
    throw new ForbiddenException('Sin organización activa');
  }

  if (requestedOrgId && requestedOrgId !== user.orgId) {
    throw new ForbiddenException('No autorizado para operar sobre esta organización');
  }

  return user.orgId;
}

/** Garantiza que el caller es platform_admin. Lanza 403 en otro caso. */
export function requirePlatformAdmin(user: JwtPayload): void {
  if (!user.isPlatformAdmin) {
    throw new ForbiddenException('Acceso restringido a platform admin');
  }
}

/**
 * Devuelve el orgId del usuario si existe, sin lanzar.
 * Útil cuando una ruta puede operar globalmente para platform_admins (sin filtro).
 */
export function getOptionalOrgId(user: JwtPayload, requestedOrgId?: string | null): string | null {
  if (user.isPlatformAdmin) {
    return requestedOrgId ?? null;
  }
  return user.orgId;
}
