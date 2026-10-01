import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { userHasAnyRole, type UserRole } from '@soe/types';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.types';

/**
 * Verifica que el usuario autenticado tenga AL MENOS UNO de los roles
 * permitidos por `@Roles(...)`. La autorización funciona por unión: si el
 * usuario tiene `homeroom_teacher` + `dept_head` y el endpoint pide
 * `dept_head`, pasa aunque su `activeRole` sea `homeroom_teacher`.
 *
 * Excepción global: los platform_admins pasan todos los chequeos de rol.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user: JwtPayload; method: string; url: string }>();
    const { user } = request;
    if (user.isPlatformAdmin) return true;
    if (!userHasAnyRole(user.roles, required)) {
      this.logger.warn(
        JSON.stringify({
          event: 'role_denied',
          method: request.method,
          url: request.url,
          userId: user.userId,
          orgId: user.orgId,
          roles: user.roles,
          required,
        }),
      );
      throw new ForbiddenException('Rol insuficiente para esta operación');
    }
    return true;
  }
}
