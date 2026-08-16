import { Injectable } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { z } from 'zod';
import { AnalyticsTool, type ToolDescriptor } from './analytics-tool';
import { ToolRegistry, isToolAllowed } from './tool-registry';
import { makePrincipal } from '../testing/make-principal';

const emptyInput = z.object({});

@AnalyticsTool()
@Injectable()
class TeacherTool implements AnalyticsTool {
  readonly descriptor: ToolDescriptor = {
    name: 'teacher_tool',
    description: 'Tool visible para docentes',
    inputSchema: emptyInput,
    requiredRoles: ['teacher', 'school_admin'],
    piiLevel: 'aggregate',
  };

  async execute(): Promise<unknown> {
    return { ok: true };
  }
}

@AnalyticsTool()
@Injectable()
class PremiumAdminTool implements AnalyticsTool {
  readonly descriptor: ToolDescriptor = {
    name: 'premium_admin_tool',
    description: 'Tool premium para administradores',
    inputSchema: emptyInput,
    requiredRoles: ['school_admin'],
    requiredFeature: 'benchmarking',
    piiLevel: 'aggregate',
  };

  async execute(): Promise<unknown> {
    return { ok: true };
  }
}

@Injectable()
class UndecoratedProvider {
  readonly descriptor: ToolDescriptor = {
    name: 'not_a_tool',
    description: 'Provider sin decorador, no debe registrarse',
    inputSchema: emptyInput,
    requiredRoles: ['teacher'],
    piiLevel: 'aggregate',
  };
}

@AnalyticsTool()
@Injectable()
class DuplicateNameTool implements AnalyticsTool {
  readonly descriptor: ToolDescriptor = {
    name: 'teacher_tool',
    description: 'Nombre duplicado a propósito',
    inputSchema: emptyInput,
    requiredRoles: ['teacher'],
    piiLevel: 'aggregate',
  };

  async execute(): Promise<unknown> {
    return { ok: true };
  }
}

async function buildRegistry(providers: unknown[]): Promise<ToolRegistry> {
  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule],
    providers: [ToolRegistry, ...(providers as never[])],
  }).compile();
  await moduleRef.init();
  return moduleRef.get(ToolRegistry);
}

describe('ToolRegistry', () => {
  it('descubre las tools decoradas y omite providers sin decorador', async () => {
    const registry = await buildRegistry([TeacherTool, PremiumAdminTool, UndecoratedProvider]);

    expect(registry.get('teacher_tool')).toBeDefined();
    expect(registry.get('premium_admin_tool')).toBeDefined();
    expect(registry.get('not_a_tool')).toBeUndefined();
    expect(registry.list()).toHaveLength(2);
  });

  it('agregar una tool nueva no requiere editar el registry (open/closed)', async () => {
    const withOne = await buildRegistry([TeacherTool]);
    const withTwo = await buildRegistry([TeacherTool, PremiumAdminTool]);

    expect(withOne.list()).toHaveLength(1);
    expect(withTwo.list()).toHaveLength(2);
  });

  it('rechaza nombres de tool duplicados al iniciar', async () => {
    await expect(buildRegistry([TeacherTool, DuplicateNameTool])).rejects.toThrow(
      'Tool analítica duplicada: teacher_tool',
    );
  });

  describe('listVisible', () => {
    it('filtra por rol: un teacher no ve tools de admin', async () => {
      const registry = await buildRegistry([TeacherTool, PremiumAdminTool]);
      const visible = registry.listVisible(makePrincipal({ roles: ['teacher'] }));

      expect(visible.map((d) => d.name)).toEqual(['teacher_tool']);
    });

    it('filtra por feature: admin sin benchmarking no ve la tool premium', async () => {
      const registry = await buildRegistry([TeacherTool, PremiumAdminTool]);

      const sinFeature = registry.listVisible(
        makePrincipal({ roles: ['school_admin'], features: [] }),
      );
      const conFeature = registry.listVisible(
        makePrincipal({ roles: ['school_admin'], features: ['benchmarking'] }),
      );

      expect(sinFeature.map((d) => d.name)).toEqual(['teacher_tool']);
      expect(conFeature.map((d) => d.name)).toEqual(['teacher_tool', 'premium_admin_tool']);
    });

    it('platform_admin ve todas las tools sin chequear rol ni feature', async () => {
      const registry = await buildRegistry([TeacherTool, PremiumAdminTool]);
      const visible = registry.listVisible(
        makePrincipal({ roles: ['platform_admin'], isPlatformAdmin: true, features: [] }),
      );

      expect(visible).toHaveLength(2);
    });
  });
});

describe('isToolAllowed', () => {
  const descriptor: ToolDescriptor = {
    name: 'x',
    description: 'x',
    inputSchema: emptyInput,
    requiredRoles: ['eval_coordinator'],
    requiredFeature: 'ai_analysis',
    piiLevel: 'aggregate',
  };

  it('exige rol y feature simultáneamente', () => {
    expect(isToolAllowed(descriptor, makePrincipal({ roles: ['teacher'] }))).toBe(false);
    expect(
      isToolAllowed(descriptor, makePrincipal({ roles: ['eval_coordinator'], features: [] })),
    ).toBe(false);
    expect(
      isToolAllowed(
        descriptor,
        makePrincipal({ roles: ['eval_coordinator'], features: ['ai_analysis'] }),
      ),
    ).toBe(true);
  });
});
