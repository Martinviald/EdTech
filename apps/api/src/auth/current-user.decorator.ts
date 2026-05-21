import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from './jwt-payload.types';

/**
 * Inyecta el `JwtPayload` del usuario autenticado en un parámetro del handler.
 * Solo válido en rutas protegidas por AuthGuard (no `@Public()`).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest<{ user: JwtPayload }>();
    return request.user;
  },
);
