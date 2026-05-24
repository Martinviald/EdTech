import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
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
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const { user } = context.switchToHttp().getRequest<{ user: JwtPayload }>();
    if (user.isPlatformAdmin) return true;
    if (!userHasAnyRole(user.roles, required)) {
      throw new ForbiddenException('Rol insuficiente para esta operación');
    }
    return true;
  }
}
