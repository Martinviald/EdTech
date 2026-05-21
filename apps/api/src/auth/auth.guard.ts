import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
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
 * cifrado NO es el `AUTH_SECRET` crudo: se deriva con HKDF-SHA256 usando como
 * `info` la cadena `"Auth.js Generated Encryption Key (<salt>)"`. Para tokens
 * transportados en el header `Authorization` el `salt` es vacío.
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

    try {
      const key = await this.getDerivedEncryptionKey();
      const { payload } = await jwtDecrypt(token, key);

      request.user = {
        userId: payload['userId'] as string,
        orgId: payload['orgId'] as string,
        role: payload['role'] as string,
        email: payload['email'] as string,
        name: payload['name'] as string,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }

  /**
   * Reproduce la derivación de clave de NextAuth v5 (`@auth/core` jwt.ts).
   * 64 bytes para A256CBC-HS512, salt vacío.
   */
  private async getDerivedEncryptionKey(): Promise<Uint8Array> {
    const secret = this.config.getOrThrow<string>('AUTH_SECRET');
    const salt = '';
    const derived = await hkdfAsync(
      'sha256',
      secret,
      salt,
      `Auth.js Generated Encryption Key (${salt})`,
      64,
    );
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
