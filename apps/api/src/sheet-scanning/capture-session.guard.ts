import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { jwtVerify } from 'jose';
import { captureSessions, withOrgContext } from '@soe/db';
import { CAPTURE_SESSION_TOKEN_SCOPE } from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import { deriveCaptureTokenKey, type ActiveCaptureSession } from './capture-token.helpers';

const INVALID_TOKEN_MESSAGE =
  'Sesión de captura inválida o vencida. Escanea un nuevo código QR desde el computador.';

type RequestWithCaptureSession = {
  headers: Record<string, string | undefined>;
  captureSession?: ActiveCaptureSession;
};

@Injectable()
export class CaptureSessionGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    @InjectDb() private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithCaptureSession>();
    const claims = await this.verifyToken(this.extractToken(request));
    await this.assertSessionUsable(claims);
    request.captureSession = claims;
    return true;
  }

  private extractToken(request: RequestWithCaptureSession): string {
    const [type, token] = request.headers['authorization']?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    return token;
  }

  private async verifyToken(token: string): Promise<ActiveCaptureSession> {
    const key = await deriveCaptureTokenKey(this.config.getOrThrow<string>('AUTH_SECRET'));
    let payload: import('jose').JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, key));
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }
    const { sessionId, orgId, printRunId, batchId, scope } = payload;
    if (
      scope !== CAPTURE_SESSION_TOKEN_SCOPE ||
      typeof sessionId !== 'string' ||
      typeof orgId !== 'string' ||
      typeof printRunId !== 'string' ||
      typeof batchId !== 'string'
    ) {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }
    return { sessionId, orgId, printRunId, batchId };
  }

  private async assertSessionUsable(claims: ActiveCaptureSession): Promise<void> {
    const row = await withOrgContext(this.db, claims.orgId, async (tx) => {
      const [session] = await tx
        .select({ status: captureSessions.status, expiresAt: captureSessions.expiresAt })
        .from(captureSessions)
        .where(
          and(eq(captureSessions.id, claims.sessionId), eq(captureSessions.orgId, claims.orgId)),
        )
        .limit(1);
      return session ?? null;
    });
    if (!row || row.status === 'revoked' || row.status === 'closed' || row.status === 'expired') {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      await withOrgContext(this.db, claims.orgId, (tx) =>
        tx
          .update(captureSessions)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(
            and(eq(captureSessions.id, claims.sessionId), eq(captureSessions.orgId, claims.orgId)),
          ),
      );
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }
  }
}

export const CurrentCaptureSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ActiveCaptureSession => {
    const request = ctx.switchToHttp().getRequest<{ captureSession: ActiveCaptureSession }>();
    return request.captureSession;
  },
);
