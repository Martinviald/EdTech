import { ForbiddenException } from '@nestjs/common';
import type { AnalyticsToolsFacade } from '../../mcp/core/analytics-tools.facade';
import type { ToolDescriptor } from '../../mcp/core/analytics-tool';
import type { McpPrincipalResolver } from '../../mcp/auth/mcp-principal.resolver';
import { AnalyticsAssistantBridge } from './analytics-tools.bridge';
import { z } from 'zod';

const BLUEPRINT: ToolDescriptor = {
  name: 'get_instrument_blueprint',
  description: 'blueprint',
  inputSchema: z.object({ instrumentId: z.string().uuid() }),
  requiredRoles: ['teacher'],
  piiLevel: 'aggregate',
};

const LIST_ASSESSMENTS: ToolDescriptor = {
  name: 'list_assessments',
  description: 'list',
  inputSchema: z.object({}),
  requiredRoles: ['teacher'],
  piiLevel: 'aggregate',
};

const jwtUser = { userId: 'u1', orgId: 'org-1', roles: ['teacher'], isPlatformAdmin: false } as never;

function makeBridge(descriptors: ToolDescriptor[], execute = jest.fn()) {
  const facade = {
    listVisible: jest.fn().mockReturnValue(descriptors),
    execute,
  } as unknown as AnalyticsToolsFacade;
  const resolver = {
    principalFromJwt: jest
      .fn()
      .mockResolvedValue({ userId: 'u1', orgId: 'org-1', roles: ['teacher'], channel: 'in-app' }),
  } as unknown as McpPrincipalResolver;
  return { bridge: new AnalyticsAssistantBridge(facade, resolver), facade, execute };
}

describe('AnalyticsAssistantBridge', () => {
  it('convierte descriptores en AssistantTool con JSON Schema', async () => {
    const { bridge } = makeBridge([BLUEPRINT]);

    const tools = await bridge.assistantTools(jwtUser, new Set());

    expect(tools).toHaveLength(1);
    expect(tools[0].definition.name).toBe('get_instrument_blueprint');
    expect(tools[0].definition.inputSchema).toMatchObject({ type: 'object' });
  });

  it('omite las tools cuyo nombre ya existe en el asistente (collision-safe)', async () => {
    const { bridge } = makeBridge([BLUEPRINT, LIST_ASSESSMENTS]);

    const tools = await bridge.assistantTools(jwtUser, new Set(['list_assessments']));

    expect(tools.map((t) => t.definition.name)).toEqual(['get_instrument_blueprint']);
  });

  it('ejecuta vía el facade con el principal in-app y serializa el resultado', async () => {
    const execute = jest.fn().mockResolvedValue({ items: [] });
    const { bridge } = makeBridge([BLUEPRINT], execute);

    const [tool] = await bridge.assistantTools(jwtUser, new Set());
    const result = await tool.execute({ instrumentId: 'i1' }, { user: jwtUser });

    expect(execute).toHaveBeenCalledWith(
      'get_instrument_blueprint',
      expect.objectContaining({ channel: 'in-app' }),
      { instrumentId: 'i1' },
    );
    expect(result).toEqual({ content: JSON.stringify({ items: [] }) });
  });

  it('convierte un HttpException del facade en un resultado de error in-band', async () => {
    const execute = jest.fn().mockRejectedValue(new ForbiddenException('sin acceso'));
    const { bridge } = makeBridge([BLUEPRINT], execute);

    const [tool] = await bridge.assistantTools(jwtUser, new Set());
    const result = await tool.execute({ instrumentId: 'i1' }, { user: jwtUser });

    expect(result.isError).toBe(true);
  });
});
