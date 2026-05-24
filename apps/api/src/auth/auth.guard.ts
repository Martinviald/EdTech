import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { jwtDecrypt } from 'jose';
import { hkdf } from 'crypto';
import { promisify } from 'util';
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

    request.user = {
      userId: payload['userId'] as string,
      orgId: payload['orgId'] as string,
      role: payload['role'] as string,
      email: payload['email'] as string,
      name: payload['name'] as string,
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
