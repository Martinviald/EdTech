import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SignJWT } from 'jose';
import type { Database } from '@soe/db';
import { CAPTURE_SESSION_TOKEN_SCOPE } from '@soe/types';
import { deriveCaptureTokenKey } from './capture-token.helpers';
import { CaptureSessionGuard } from './capture-session.guard';

const ORG_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const BATCH_ID = '55555555-5555-4555-8555-555555555555';
const RUN_ID = '66666666-6666-4666-8666-666666666666';
const AUTH_SECRET = 'test-auth-secret';

const CLAIMS = {
  sessionId: SESSION_ID,
  orgId: ORG_ID,
  printRunId: RUN_ID,
  batchId: BATCH_ID,
  scope: CAPTURE_SESSION_TOKEN_SCOPE,
};

type RecordedUpdate = { set: Record<string, unknown> };

function makeDb(selectResults: unknown[][]): { db: Database; updates: RecordedUpdate[] } {
  let selectIdx = 0;
  const updates: RecordedUpdate[] = [];

  function chain(rows: unknown[]): Record<string, unknown> {
    const c: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'limit']) {
      c[method] = () => c;
    }
    c.then = (resolve: (rows: unknown[]) => unknown, reject?: (err: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject);
    return c;
  }

  const db = {
    select: () => chain(selectResults[selectIdx++] ?? []),
    update: () => ({
      set: (set: Record<string, unknown>) => {
        updates.push({ set });
        return { where: () => Promise.resolve([]) };
      },
    }),
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  } as unknown as Database;

  return { db, updates };
}

async function makeToken(
  claims: Record<string, unknown> = CLAIMS,
  options: { secret?: string; expiresInSeconds?: number } = {},
): Promise<string> {
  const key = await deriveCaptureTokenKey(options.secret ?? AUTH_SECRET);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? 600))
    .sign(key);
}

function makeContext(authorization?: string): {
  context: ExecutionContext;
  request: Record<string, unknown>;
} {
  const request: Record<string, unknown> = { headers: { authorization } };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function makeGuard(selectResults: unknown[][]) {
  const { db, updates } = makeDb(selectResults);
  const config = { getOrThrow: jest.fn().mockReturnValue(AUTH_SECRET) } as unknown as ConfigService;
  return { guard: new CaptureSessionGuard(config, db), updates };
}

function activeRow(): Record<string, unknown> {
  return { status: 'active', expiresAt: new Date(Date.now() + 10 * 60_000) };
}

describe('CaptureSessionGuard', () => {
  it('acepta un token válido y deja el contexto de la sesión en la request', async () => {
    const { guard } = makeGuard([[activeRow()]]);
    const { context, request } = makeContext(`Bearer ${await makeToken()}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.captureSession).toEqual({
      sessionId: SESSION_ID,
      orgId: ORG_ID,
      printRunId: RUN_ID,
      batchId: BATCH_ID,
    });
  });

  it('rechaza una request sin header Authorization', async () => {
    const { guard } = makeGuard([]);
    const { context } = makeContext(undefined);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza un token con scope ajeno', async () => {
    const { guard } = makeGuard([[activeRow()]]);
    const token = await makeToken({ ...CLAIMS, scope: 'user-session' });
    const { context } = makeContext(`Bearer ${token}`);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza un token vencido', async () => {
    const { guard } = makeGuard([[activeRow()]]);
    const token = await makeToken(CLAIMS, { expiresInSeconds: -60 });
    const { context } = makeContext(`Bearer ${token}`);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza un token firmado con otra clave', async () => {
    const { guard } = makeGuard([[activeRow()]]);
    const token = await makeToken(CLAIMS, { secret: 'otro-secreto' });
    const { context } = makeContext(`Bearer ${token}`);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza cuando la sesión fue revocada', async () => {
    const { guard } = makeGuard([[{ status: 'revoked', expiresAt: new Date() }]]);
    const { context } = makeContext(`Bearer ${await makeToken()}`);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza cuando la sesión ya no existe', async () => {
    const { guard } = makeGuard([[]]);
    const { context } = makeContext(`Bearer ${await makeToken()}`);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('marca expired la sesión vencida por tiempo y rechaza', async () => {
    const { guard, updates } = makeGuard([
      [{ status: 'active', expiresAt: new Date(Date.now() - 60_000) }],
    ]);
    const { context } = makeContext(`Bearer ${await makeToken()}`);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(updates).toHaveLength(1);
    expect(updates[0].set.status).toBe('expired');
  });
});
