import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { JwtPayload } from '../../auth/jwt-payload.types';

/**
 * Restringe el acceso a datos psicopedagógicos sensibles (`profile.nee`,
 * `profile.sensitiveNotes`) a roles directivos. Un profesor estándar nunca
 * accede a estos campos (Ley 19.628 — datos sensibles de menores).
 */
const SENSITIVE_ROLES = ['school_admin', 'academic_director', 'eval_coordinator', 'platform_admin'];

@Injectable()
export class SensitiveDataGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<{ user: JwtPayload }>();
    if (!SENSITIVE_ROLES.includes(user.role)) {
      throw new ForbiddenException('Sin acceso a datos psicopedagógicos');
    }
    return true;
  }
}
