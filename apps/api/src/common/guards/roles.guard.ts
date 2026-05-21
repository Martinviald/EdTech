import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.types';

/**
 * Verifica que el rol del usuario autenticado esté entre los permitidos
 * por el decorador `@Roles(...)`. Si la ruta no declara roles, permite el paso.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const { user } = context.switchToHttp().getRequest<{ user: JwtPayload }>();
    if (!required.includes(user.role)) {
      throw new ForbiddenException('Rol insuficiente para esta operación');
    }
    return true;
  }
}
