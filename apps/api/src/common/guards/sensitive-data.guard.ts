import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { SENSITIVE_DATA_ROLES, userHasAnyRole } from '@soe/types';
import type { JwtPayload } from '../../auth/jwt-payload.types';

/**
 * Restringe el acceso a datos psicopedagógicos sensibles (`profile.nee`,
 * `profile.sensitiveNotes`) a roles directivos. Un profesor estándar nunca
 * accede a estos campos (Ley 19.628 — datos sensibles de menores).
 *
 * Autoriza por unión: si alguno de los roles del usuario está en
 * SENSITIVE_DATA_ROLES, pasa. Coherente con el modelo multi-rol — un usuario
 * eval_coordinator que también es teacher mantiene acceso aunque su
 * activeRole sea teacher.
 */
@Injectable()
export class SensitiveDataGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<{ user: JwtPayload }>();
    if (user.isPlatformAdmin) return true;
    if (!userHasAnyRole(user.roles, SENSITIVE_DATA_ROLES)) {
      throw new ForbiddenException('Sin acceso a datos psicopedagógicos');
    }
    return true;
  }
}
