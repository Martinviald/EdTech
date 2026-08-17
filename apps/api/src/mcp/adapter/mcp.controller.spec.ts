import { type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AnalyticsTool, type ToolDescriptor } from '../core/analytics-tool';
import { McpController } from './mcp.controller';
import { McpThrottlerGuard } from './mcp-throttler.guard';
import { McpAuthGuard } from '../auth/mcp-auth.guard';
import { ProtectedResourceController } from '../auth/protected-resource.controller';
import { AnalyticsToolsFacade } from '../core/analytics-tools.facade';
import { McpAuditLogger } from '../core/mcp-audit-logger';
import { McpResourceProvider, type McpResource, type ResourceDescriptor } from '../core/mcp-resource';
import { PromptRegistry } from '../core/prompt-registry';
import { ResourceRegistry } from '../core/resource-registry';
import { ToolRegistry } from '../core/tool-registry';
import { ContrastarDificultadPrompt } from '../prompts/contrastar-dificultad.prompt';
import { WhoamiTool } from '../tools/whoami.tool';
import { makePrincipal } from '../testing/make-principal';

@McpResourceProvider()
@Injectable()
class FakeTaxonomyResource implements McpResource {
  readonly descriptor: ResourceDescriptor = {
    scheme: 'taxonomy',
    uriTemplate: 'taxonomy://{taxonomyId}',
    name: 'Árbol de taxonomía',
    description: 'Recurso de prueba',
    mimeType: 'application/json',
    requiredRoles: ['teacher'],
  };

  async read(_principal: unknown, id: string): Promise<unknown> {
    return { taxonomyId: id, nodes: [] };
  }
}

@AnalyticsTool()
@Injectable()
class FakeGapsTool {
  readonly descriptor: ToolDescriptor = {
    name: 'get_fake_gaps',
    description: 'Tool de datos de prueba (org-scoped)',
    inputSchema: z.object({}),
    requiredRoles: ['teacher'],
    piiLevel: 'aggregate',
  };

  async execute(): Promise<unknown> {
    return { gaps: [1, 2] };
  }
}

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
        PromptRegistry,
        ResourceRegistry,
        AnalyticsToolsFacade,
        WhoamiTool,
        FakeGapsTool,
        ContrastarDificultadPrompt,
        FakeTaxonomyResource,
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

  it('POST /mcp tools/call de una tool de datos prefija la organización activa', async () => {
    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set(MCP_HEADERS)
      .send(rpc('tools/call', { name: 'get_fake_gaps', arguments: {} }))
      .expect(200);

    const text = res.body.result.content[0].text as string;
    expect(text.startsWith('Organización: Colegio Test (org-1)\n')).toBe(true);
    expect(JSON.parse(text.slice(text.indexOf('\n') + 1))).toEqual({ gaps: [1, 2] });
  });

  it('POST /mcp tools/call whoami NO prefija organización (tool exenta)', async () => {
    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set(MCP_HEADERS)
      .send(rpc('tools/call', { name: 'whoami', arguments: {} }))
      .expect(200);

    const text = res.body.result.content[0].text as string;
    expect(text.startsWith('Organización:')).toBe(false);
  });

  it('POST /mcp tools/call de una tool desconocida devuelve error in-band', async () => {
    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set(MCP_HEADERS)
      .send(rpc('tools/call', { name: 'inexistente', arguments: {} }))
      .expect(200);

    expect(res.body.result.isError).toBe(true);
  });

  it('POST /mcp prompts/list anuncia el prompt del caso estrella', async () => {
    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set(MCP_HEADERS)
      .send(rpc('prompts/list'))
      .expect(200);

    const names = (res.body.result.prompts as Array<{ name: string }>).map((p) => p.name);
    expect(names).toContain('contrastar_dificultad_declarada_vs_empirica');
  });

  it('POST /mcp prompts/get renderiza los mensajes con los argumentos', async () => {
    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set(MCP_HEADERS)
      .send(
        rpc('prompts/get', {
          name: 'contrastar_dificultad_declarada_vs_empirica',
          arguments: { instrumentId: 'inst-9', assessmentId: 'assess-9' },
        }),
      )
      .expect(200);

    const text = res.body.result.messages[0].content.text as string;
    expect(text).toContain('inst-9');
    expect(text).toContain('assess-9');
  });

  it('POST /mcp resources/templates/list anuncia las plantillas visibles', async () => {
    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set(MCP_HEADERS)
      .send(rpc('resources/templates/list'))
      .expect(200);

    const templates = res.body.result.resourceTemplates as Array<{ uriTemplate: string }>;
    expect(templates.map((t) => t.uriTemplate)).toContain('taxonomy://{taxonomyId}');
  });

  it('POST /mcp resources/read resuelve el esquema y devuelve el contenido', async () => {
    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set(MCP_HEADERS)
      .send(rpc('resources/read', { uri: 'taxonomy://tax-1' }))
      .expect(200);

    const content = res.body.result.contents[0];
    expect(content.uri).toBe('taxonomy://tax-1');
    expect(JSON.parse(content.text)).toMatchObject({ taxonomyId: 'tax-1' });
  });

  it('GET /mcp responde 405 (stateless)', async () => {
    await request(app.getHttpServer()).get('/mcp').expect(405);
  });
});
