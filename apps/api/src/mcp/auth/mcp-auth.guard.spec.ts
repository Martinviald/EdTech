import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { jwtVerify } from 'jose';
import type { McpPrincipalResolver } from './mcp-principal.resolver';
import { McpAuthGuard } from './mcp-auth.guard';
import { makePrincipal } from '../testing/make-principal';

jest.mock('jose', () => ({
  ...jest.requireActual('jose'),
  createRemoteJWKSet: jest.fn(() => jest.fn()),
  jwtVerify: jest.fn(),
}));

const jwtVerifyMock = jwtVerify as unknown as jest.Mock;

const CONFIG_VALUES: Record<string, string> = {
  MCP_ENABLED: 'true',
  MCP_CANONICAL_URI: 'http://localhost:4000/mcp',
  WORKOS_ISSUER: 'https://auth.workos.test',
  WORKOS_JWKS_URL: 'https://auth.workos.test/oauth2/jwks',
};

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  const values = { ...CONFIG_VALUES, ...overrides };
  return {
    get: (key: string, defaultValue?: string) => values[key] ?? defaultValue,
  } as unknown as ConfigService;
}

function makeContext(headers: Record<string, string | undefined>) {
  const request = { headers } as { headers: Record<string, string | undefined>; user?: unknown };
  const response = { setHeader: jest.fn() };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, request, response };
}

function makeResolver(
  principal = makePrincipal({ channel: 'mcp-external', features: ['mcp'] }),
): McpPrincipalResolver {
  return {
    resolve: jest.fn().mockResolvedValue(principal),
  } as unknown as McpPrincipalResolver;
}

describe('McpAuthGuard', () => {
  beforeEach(() => {
    jwtVerifyMock.mockReset();
  });

  it('responde 404 cuando MCP_ENABLED no es true', async () => {
    const guard = new McpAuthGuard(makeConfig({ MCP_ENABLED: 'false' }), makeResolver());
    const { context } = makeContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('responde 401 con WWW-Authenticate cuando falta el token', async () => {
    const guard = new McpAuthGuard(makeConfig(), makeResolver());
    const { context, response } = makeContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(response.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringContaining(
        'resource_metadata="http://localhost:4000/.well-known/oauth-protected-resource"',
      ),
    );
  });

  it('responde 401 cuando el token no valida (firma, expiración o audiencia)', async () => {
    jwtVerifyMock.mockRejectedValue(new Error('aud mismatch'));
    const guard = new McpAuthGuard(makeConfig(), makeResolver());
    const { context } = makeContext({ authorization: 'Bearer token-ajeno' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwtVerifyMock).toHaveBeenCalledWith('token-ajeno', expect.anything(), {
      issuer: CONFIG_VALUES.WORKOS_ISSUER,
      audience: CONFIG_VALUES.MCP_CANONICAL_URI,
    });
  });

  it('responde 401 cuando el token valida pero no trae claim email', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 'user_123' } });
    const guard = new McpAuthGuard(makeConfig(), makeResolver());
    const { context } = makeContext({ authorization: 'Bearer sin-email' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('con token válido resuelve el principal y lo adjunta al request', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'user_123', email: 'docente@colegio.cl' },
    });
    const resolver = makeResolver();
    const guard = new McpAuthGuard(makeConfig(), resolver);
    const { context, request } = makeContext({ authorization: 'Bearer valido' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(resolver.resolve).toHaveBeenCalledWith('docente@colegio.cl');
    expect(request.user).toMatchObject({ channel: 'mcp-external' });
  });

  it('responde 403 cuando la org no tiene la feature mcp habilitada', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { email: 'docente@colegio.cl' },
    });
    const resolver = makeResolver(
      makePrincipal({ channel: 'mcp-external', roles: ['teacher'], features: [] }),
    );
    const guard = new McpAuthGuard(makeConfig(), resolver);
    const { context } = makeContext({ authorization: 'Bearer valido' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('permite a un platform_admin aunque la org no liste la feature mcp', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { email: 'admin@academos.cl' } });
    const resolver = makeResolver(
      makePrincipal({
        channel: 'mcp-external',
        isPlatformAdmin: true,
        roles: ['platform_admin'],
        features: [],
      }),
    );
    const guard = new McpAuthGuard(makeConfig(), resolver);
    const { context } = makeContext({ authorization: 'Bearer valido' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('propaga el Forbidden del resolver (email autenticado pero sin acceso)', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { email: 'desconocido@otro.cl' },
    });
    const resolver = {
      resolve: jest.fn().mockRejectedValue(new ForbiddenException()),
    } as unknown as McpPrincipalResolver;
    const guard = new McpAuthGuard(makeConfig(), resolver);
    const { context } = makeContext({ authorization: 'Bearer valido' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
