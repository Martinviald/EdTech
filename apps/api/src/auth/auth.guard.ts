import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { jwtDecrypt } from 'jose';
import { hkdf } from 'crypto';
import { promisify } from 'util';
import { USER_ROLES, type UserRole } from '@soe/types';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';

const hkdfAsync = promisify(hkdf);

/**
 * Guard global de autenticación. Valida el JWE emitido por NextAuth v5.
 *
 * NextAuth v5 cifra el JWT como JWE (`dir` + `A256CBC-HS512`). La clave de
 * cifrado NO es el `AUTH_SECRET` crudo: se deriva con HKDF-SHA256 donde el
 * salt es el nombre de la cookie (`authjs.session-token`). Se intentan ambas
 * variantes para soportar HTTP (dev) y HTTPS (prod) automáticamente.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Token requerido');

    // NextAuth v5 uses the cookie name as HKDF salt; try both variants.
    const salts = ['authjs.session-token', '__Secure-authjs.session-token'];
    let payload: import('jose').JWTPayload | undefined;

    for (const salt of salts) {
      try {
        const key = await this.getDerivedEncryptionKey(salt);
        ({ payload } = await jwtDecrypt(token, key));
        break;
      } catch {
        // try next salt
      }
    }

    if (!payload) throw new UnauthorizedException('Token inválido o expirado');

    const isPlatformAdmin = Boolean(payload['isPlatformAdmin']);

    // Backward-compat: tokens viejos sólo traen `role` singular. Si no viene
    // `roles[]`, construimos el array a partir de `role`. Si tampoco viene
    // `activeRole`, lo derivamos de `role`. Una vez todos los tokens en
    // circulación tengan `roles[]`, este fallback puede removerse.
    const legacyRole = payload['role'] as string | undefined;
    const rolesRaw = payload['roles'] as unknown;
    const roles: UserRole[] = Array.isArray(rolesRaw)
      ? rolesRaw.filter(
          (r): r is UserRole =>
            typeof r === 'string' && (USER_ROLES as readonly string[]).includes(r),
        )
      : legacyRole && (USER_ROLES as readonly string[]).includes(legacyRole)
        ? [legacyRole as UserRole]
        : [];

    if (roles.length === 0) {
      throw new UnauthorizedException('Token sin roles válidos');
    }

    const activeRoleRaw = (payload['activeRole'] as string | undefined) ?? legacyRole ?? roles[0];
    if (!(USER_ROLES as readonly string[]).includes(activeRoleRaw)) {
      throw new UnauthorizedException('Token con activeRole inválido');
    }
    const activeRole = activeRoleRaw as UserRole;

    // Defensive: si el rol activo es platform_admin debe traer también el flag.
    if (activeRole === 'platform_admin' && !isPlatformAdmin) {
      throw new UnauthorizedException('Token inconsistente');
    }

    // Multi-org: `orgs` lista las orgs del usuario para validar el switch.
    // Tokens viejos (pre-multi-org) no lo traen → array vacío (el selector no
    // se renderiza y switch-org queda deshabilitado hasta el próximo login).
    const orgsRaw = payload['orgs'] as unknown;
    const orgs: Array<{ id: string; name: string }> = Array.isArray(orgsRaw)
      ? orgsRaw.filter(
          (o): o is { id: string; name: string } =>
            typeof o === 'object' &&
            o !== null &&
            typeof (o as { id?: unknown }).id === 'string' &&
            typeof (o as { name?: unknown }).name === 'string',
        )
      : [];

    request.user = {
      userId: payload['userId'] as string,
      orgId: (payload['orgId'] as string | null | undefined) ?? null,
      orgName: (payload['orgName'] as string | null | undefined) ?? null,
      orgs,
      email: payload['email'] as string,
      name: payload['name'] as string,
      isPlatformAdmin,
      roles,
      activeRole,
      role: activeRole,
    };
    return true;
  }

  /**
   * Reproduce la derivación de clave de NextAuth v5 (`@auth/core` jwt.ts).
   * 64 bytes para A256CBC-HS512. El salt es el nombre de la cookie de sesión,
   * no un string vacío — NextAuth llama encode({ salt: cookie.name }).
   */
  private async getDerivedEncryptionKey(salt: string): Promise<Uint8Array> {
    const secret = this.config.getOrThrow<string>('AUTH_SECRET');
    const info = `Auth.js Generated Encryption Key${salt ? ` (${salt})` : ''}`;
    const derived = await hkdfAsync('sha256', secret, salt, info, 64);
    return new Uint8Array(derived);
  }

  private extractToken(request: {
    headers: Record<string, string | undefined>;
  }): string | undefined {
    const authHeader = request.headers['authorization'];
    const [type, token] = authHeader?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
