import { type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { McpController } from './mcp.controller';
import { McpThrottlerGuard } from './mcp-throttler.guard';
import { McpAuthGuard } from '../auth/mcp-auth.guard';
import { ProtectedResourceController } from '../auth/protected-resource.controller';
import { AnalyticsToolsFacade } from '../core/analytics-tools.facade';
import { McpAuditLogger } from '../core/mcp-audit-logger';
import { ToolRegistry } from '../core/tool-registry';
import { WhoamiTool } from '../tools/whoami.tool';
import { makePrincipal } from '../testing/make-principal';

const CONFIG_VALUES: Record<string, string> = {
  MCP_ENABLED: 'true',
  MCP_CANONICAL_URI: 'http://localhost:4000/mcp',
  WORKOS_ISSUER: 'https://auth.workos.test',
  WORKOS_JWKS_URL: 'https://auth.workos.test/oauth2/jwks',
};

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

function rpc(method: string, params: Record<string, unknown> = {}, id = 1) {
  return { jsonrpc: '2.0', id, method, params };
}

describe('McpController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [McpController, ProtectedResourceController],
      providers: [
        ToolRegistry,
        AnalyticsToolsFacade,
        WhoamiTool,
        { provide: McpAuditLogger, useValue: { record: jest.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: string) => CONFIG_VALUES[key] ?? defaultValue,
            getOrThrow: (key: string) => {
              const value = CONFIG_VALUES[key];
              if (!value) throw new Error(`Config faltante: ${key}`);
              return value;
            },
          },
        },
      ],
    })
      .overrideGuard(McpAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => { user?: unknown } };
        }) => {
          context.switchToHttp().getRequest().user = makePrincipal({
            channel: 'mcp-external',
          });
          return true;
        },
      })
      .overrideGuard(McpThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /.well-known/oauth-protected-resource devuelve la metadata RFC 9728', async () => {
    const res = await request(app.getHttpServer())
      .get('/.well-known/oauth-protected-resource')
      .expect(200);

    expect(res.body).toEqual({
      resource: CONFIG_VALUES.MCP_CANONICAL_URI,
      authorization_servers: [CONFIG_VALUES.WORKOS_ISSUER],
      bearer_methods_supported: ['header'],
    });
  });

  it('POST /mcp initialize responde con la info del servidor', async () => {
    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set(MCP_HEADERS)
      .send(
        rpc('initialize', {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '0.0.1' },
        }),
      )
      .expect(200);

    expect(res.body.result.serverInfo.name).toBe('academos-analitico');
  });

  it('POST /mcp tools/list anuncia whoami con su schema', async () => {
    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set(MCP_HEADERS)
      .send(rpc('tools/list'))
      .expect(200);

    const tools = res.body.result.tools as Array<{ name: string; inputSchema: unknown }>;
    expect(tools.map((t) => t.name)).toContain('whoami');
    expect(tools.find((t) => t.name === 'whoami')?.inputSchema).toMatchObject({
      type: 'object',
    });
  });

  it('POST /mcp tools/call whoami devuelve la identidad del principal', async () => {
    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set(MCP_HEADERS)
      .send(rpc('tools/call', { name: 'whoami', arguments: {} }))
      .expect(200);

    const structured = res.body.result.structuredContent as Record<string, unknown>;
    expect(structured).toMatchObject({
      userId: 'user-1',
      orgId: 'org-1',
      channel: 'mcp-external',
    });
  });

  it('POST /mcp tools/call de una tool desconocida devuelve error in-band', async () => {
    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set(MCP_HEADERS)
      .send(rpc('tools/call', { name: 'inexistente', arguments: {} }))
      .expect(200);

    expect(res.body.result.isError).toBe(true);
  });

  it('GET /mcp responde 405 (stateless)', async () => {
    await request(app.getHttpServer()).get('/mcp').expect(405);
  });
});
