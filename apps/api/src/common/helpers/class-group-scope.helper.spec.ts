/**
 * El helper de alcance es el punto ÚNICO de aislamiento por docente de la
 * plataforma (lo consumen resultados, dashboards, heatmap, tablero maestro,
 * analítica, informes y los tools MCP) y hasta la Fase 0 del plan de alcance
 * docente no tenía tests propios: se probaba de refilón en cada servicio.
 */
import { ForbiddenException } from '@nestjs/common';
import type { Database } from '@soe/db';
import {
  ADMIN_LIKE_ROLES,
  assertTargetInScope,
  isClassGroupInScope,
  isStudentVisibleInScope,
  resolveClassGroupScope,
} from './class-group-scope.helper';
import { makeQueueDb, makeScopedUser } from './scope-test-utils';

describe('resolveClassGroupScope', () => {
  it('platform_admin ve toda la org sin consultar asignaciones', async () => {
    const db = makeQueueDb([]);
    const scope = await resolveClassGroupScope(
      db as Database,
      makeScopedUser({ isPlatformAdmin: true, roles: ['platform_admin'] }),
      'org-1',
    );
    expect(scope).toEqual({ scopeAll: true, classGroupIds: [] });
  });

  it.each(ADMIN_LIKE_ROLES)('%s es admin-like → scopeAll', async (role) => {
    const db = makeQueueDb([]);
    const scope = await resolveClassGroupScope(
      db as Database,
      makeScopedUser({ roles: [role], activeRole: role }),
      'org-1',
    );
    expect(scope.scopeAll).toBe(true);
  });

  it('un profesor obtiene los cursos de sus asignaciones, deduplicados', async () => {
    const db = makeQueueDb([
      [{ classGroupId: 'cg-1' }, { classGroupId: 'cg-2' }, { classGroupId: 'cg-1' }],
    ]);
    const scope = await resolveClassGroupScope(db as Database, makeScopedUser(), 'org-1');
    expect(scope.scopeAll).toBe(false);
    expect(scope.classGroupIds.sort()).toEqual(['cg-1', 'cg-2']);
  });

  it('un profesor sin asignaciones queda con alcance vacío (no con acceso total)', async () => {
    const db = makeQueueDb([[]]);
    const scope = await resolveClassGroupScope(db as Database, makeScopedUser(), 'org-1');
    expect(scope).toEqual({ scopeAll: false, classGroupIds: [] });
  });

  it('un rol sin acceso a resultados no obtiene alcance alguno', async () => {
    const db = makeQueueDb([[{ classGroupId: 'cg-1' }]]);
    const scope = await resolveClassGroupScope(
      db as Database,
      makeScopedUser({ roles: ['guardian'], activeRole: 'guardian' }),
      'org-1',
    );
    expect(scope).toEqual({ scopeAll: false, classGroupIds: [] });
  });

  it('teacher + dept_head: la unión de roles gana (admin-like)', async () => {
    const db = makeQueueDb([]);
    const scope = await resolveClassGroupScope(
      db as Database,
      makeScopedUser({ roles: ['teacher', 'dept_head'], activeRole: 'teacher' }),
      'org-1',
    );
    expect(scope.scopeAll).toBe(true);
  });
});

describe('isClassGroupInScope', () => {
  it('scopeAll alcanza cualquier curso', () => {
    expect(isClassGroupInScope({ scopeAll: true, classGroupIds: [] }, 'cg-x')).toBe(true);
  });

  it('acota a la lista cuando no es scopeAll', () => {
    const scope = { scopeAll: false, classGroupIds: ['cg-1'] };
    expect(isClassGroupInScope(scope, 'cg-1')).toBe(true);
    expect(isClassGroupInScope(scope, 'cg-2')).toBe(false);
  });
});

describe('assertTargetInScope', () => {
  const teacherScope = { scopeAll: false, classGroupIds: ['cg-propio'] };

  it('no consulta nada con scopeAll', async () => {
    const db = makeQueueDb([]);
    await expect(
      assertTargetInScope(
        db as Database,
        { scopeAll: true, classGroupIds: [] },
        {
          assessmentId: 'as-1',
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('acepta un curso propio sin mirar la evaluación', async () => {
    const db = makeQueueDb([]);
    await expect(
      assertTargetInScope(db as Database, teacherScope, { classGroupId: 'cg-propio' }),
    ).resolves.toBeUndefined();
  });

  it('rechaza un curso ajeno', async () => {
    const db = makeQueueDb([]);
    await expect(
      assertTargetInScope(db as Database, teacherScope, { classGroupId: 'cg-ajeno' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sin curso: acepta si TODOS los cursos de la evaluación están en el alcance', async () => {
    const db = makeQueueDb([[{ classGroupId: 'cg-propio' }]]);
    await expect(
      assertTargetInScope(db as Database, teacherScope, { assessmentId: 'as-1' }),
    ).resolves.toBeUndefined();
  });

  it('sin curso: rechaza si la evaluación abarca algún curso ajeno', async () => {
    const db = makeQueueDb([[{ classGroupId: 'cg-propio' }, { classGroupId: 'cg-ajeno' }]]);
    await expect(
      assertTargetInScope(db as Database, teacherScope, { assessmentId: 'as-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sin curso: rechaza una evaluación sin cursos asignados', async () => {
    const db = makeQueueDb([[]]);
    await expect(
      assertTargetInScope(db as Database, teacherScope, { assessmentId: 'as-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rechaza un objetivo sin curso ni evaluación', async () => {
    const db = makeQueueDb([]);
    await expect(assertTargetInScope(db as Database, teacherScope, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('isStudentVisibleInScope', () => {
  it('alumno inexistente en la org → invisible', async () => {
    const db = makeQueueDb([[]]);
    const visible = await isStudentVisibleInScope(
      db as Database,
      'org-1',
      { scopeAll: true, classGroupIds: [] },
      'st-1',
    );
    expect(visible).toBe(false);
  });

  it('scopeAll ve a cualquier alumno de la org', async () => {
    const db = makeQueueDb([[{ id: 'st-1' }]]);
    const visible = await isStudentVisibleInScope(
      db as Database,
      'org-1',
      { scopeAll: true, classGroupIds: [] },
      'st-1',
    );
    expect(visible).toBe(true);
  });

  it('un profesor sin cursos no ve a ningún alumno', async () => {
    const db = makeQueueDb([[{ id: 'st-1' }]]);
    const visible = await isStudentVisibleInScope(
      db as Database,
      'org-1',
      { scopeAll: false, classGroupIds: [] },
      'st-1',
    );
    expect(visible).toBe(false);
  });

  it('visible sólo si tiene matrícula en un curso del alcance', async () => {
    const conMatricula = makeQueueDb([[{ id: 'st-1' }], [{ id: 'en-1' }]]);
    await expect(
      isStudentVisibleInScope(
        conMatricula as Database,
        'org-1',
        { scopeAll: false, classGroupIds: ['cg-propio'] },
        'st-1',
      ),
    ).resolves.toBe(true);

    const sinMatricula = makeQueueDb([[{ id: 'st-1' }], []]);
    await expect(
      isStudentVisibleInScope(
        sinMatricula as Database,
        'org-1',
        { scopeAll: false, classGroupIds: ['cg-propio'] },
        'st-1',
      ),
    ).resolves.toBe(false);
  });
});
