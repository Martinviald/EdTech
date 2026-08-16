import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { AnalyticsPrincipal } from './analytics-principal';
import type { AnalyticsTool, ToolDescriptor } from './analytics-tool';
import { AnalyticsToolsFacade } from './analytics-tools.facade';
import { ToolRegistry, isToolAllowed } from './tool-registry';
import { makePrincipal } from '../testing/make-principal';

function makeFacade(tools: AnalyticsTool[]): AnalyticsToolsFacade {
  const byName = new Map(tools.map((tool) => [tool.descriptor.name, tool]));
  const registry = {
    get: (name: string) => byName.get(name),
    list: () => tools.map((tool) => tool.descriptor),
    listVisible: (principal: AnalyticsPrincipal) =>
      tools
        .map((tool) => tool.descriptor)
        .filter((descriptor) => isToolAllowed(descriptor, principal)),
  } as unknown as ToolRegistry;
  return new AnalyticsToolsFacade(registry);
}

function makeTool(
  overrides: Partial<ToolDescriptor> = {},
  execute: AnalyticsTool['execute'] = async () => ({ ok: true }),
): AnalyticsTool {
  return {
    descriptor: {
      name: 'demo_tool',
      description: 'Tool de prueba',
      inputSchema: z.object({ assessmentId: z.string().uuid() }),
      requiredRoles: ['teacher'],
      piiLevel: 'aggregate',
      ...overrides,
    },
    execute,
  };
}

const VALID_UUID = '5f2b1c1e-0000-4000-8000-000000000000';

describe('AnalyticsToolsFacade', () => {
  it('lanza NotFound para una tool desconocida', async () => {
    const facade = makeFacade([]);

    await expect(facade.execute('nope', makePrincipal(), {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lanza Forbidden cuando el rol no alcanza, aunque la tool exista', async () => {
    const facade = makeFacade([makeTool({ requiredRoles: ['school_admin'] })]);

    await expect(
      facade.execute('demo_tool', makePrincipal({ roles: ['teacher'] }), {
        assessmentId: VALID_UUID,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lanza BadRequest cuando el input no valida contra el schema', async () => {
    const facade = makeFacade([makeTool()]);

    await expect(
      facade.execute('demo_tool', makePrincipal(), { assessmentId: 'no-es-uuid' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ejecuta la tool con el input parseado y el principal recibido', async () => {
    const execute = jest.fn().mockResolvedValue({ resultado: 42 });
    const facade = makeFacade([makeTool({}, execute)]);
    const principal = makePrincipal();

    const result = await facade.execute('demo_tool', principal, {
      assessmentId: VALID_UUID,
    });

    expect(result).toEqual({ resultado: 42 });
    expect(execute).toHaveBeenCalledWith(principal, { assessmentId: VALID_UUID });
  });

  it('listVisible delega el filtrado por rol/feature', () => {
    const facade = makeFacade([
      makeTool({ name: 'para_teacher', requiredRoles: ['teacher'] }),
      makeTool({ name: 'para_admin', requiredRoles: ['school_admin'] }),
    ]);

    const visible = facade.listVisible(makePrincipal({ roles: ['teacher'] }));

    expect(visible.map((d) => d.name)).toEqual(['para_teacher']);
  });
});
