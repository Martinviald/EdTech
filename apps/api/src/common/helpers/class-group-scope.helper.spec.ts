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
  isAssessmentInScope,
  isClassGroupInScope,
  isStudentVisibleInScope,
  resolveClassGroupScope,
} from './class-group-scope.helper';
import { makeQueueDb, makeScope, makeScopedUser } from './scope-test-utils';

describe('resolveClassGroupScope', () => {
  it('platform_admin ve toda la org sin consultar asignaciones', async () => {
    const db = makeQueueDb([]);
    const scope = await resolveClassGroupScope(
      db as Database,
      makeScopedUser({ isPlatformAdmin: true, roles: ['platform_admin'] }),
      'org-1',
    );
    expect(scope).toEqual(makeScope({ scopeAll: true }));
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
    expect(scope).toEqual(makeScope({}));
  });

  it('un rol sin acceso a resultados no obtiene alcance alguno', async () => {
    const db = makeQueueDb([[{ classGroupId: 'cg-1' }]]);
    const scope = await resolveClassGroupScope(
      db as Database,
      makeScopedUser({ roles: ['guardian'], activeRole: 'guardian' }),
      'org-1',
    );
    expect(scope).toEqual(makeScope({}));
  });

  it('teacher + dept_head con rol activo teacher: alcance de PROFESOR', async () => {
    // Fase 4: el alcance lo decide `activeRole`, no la unión. Antes este mismo
    // usuario obtenía scopeAll y el selector de rol no cambiaba nada.
    const db = makeQueueDb([[{ classGroupId: 'cg-1', subjectId: 'MATH' }]]);
    const scope = await resolveClassGroupScope(
      db as Database,
      makeScopedUser({ roles: ['teacher', 'dept_head'], activeRole: 'teacher' }),
      'org-1',
    );
    expect(scope.scopeAll).toBe(false);
    expect(scope.classGroupIds).toEqual(['cg-1']);
  });

  it('el mismo usuario con rol activo dept_head ve toda la organización', async () => {
    const db = makeQueueDb([]);
    const scope = await resolveClassGroupScope(
      db as Database,
      makeScopedUser({ roles: ['teacher', 'dept_head'], activeRole: 'dept_head' }),
      'org-1',
    );
    expect(scope.scopeAll).toBe(true);
  });

  it('sin activeRole cae a la unión de roles (tokens legacy)', async () => {
    const db = makeQueueDb([]);
    const scope = await resolveClassGroupScope(
      db as Database,
      { ...makeScopedUser({ roles: ['teacher', 'dept_head'] }), activeRole: undefined } as never,
      'org-1',
    );
    expect(scope.scopeAll).toBe(true);
  });
});

describe('isClassGroupInScope', () => {
  it('scopeAll alcanza cualquier curso', () => {
    expect(isClassGroupInScope(makeScope({ scopeAll: true }), 'cg-x')).toBe(true);
  });

  it('acota a la lista cuando no es scopeAll', () => {
    const scope = makeScope({ classGroupIds: ['cg-1'] });
    expect(isClassGroupInScope(scope, 'cg-1')).toBe(true);
    expect(isClassGroupInScope(scope, 'cg-2')).toBe(false);
  });
});

describe('assertTargetInScope', () => {
  const teacherScope = makeScope({ classGroupIds: ['cg-propio'] });

  it('no consulta nada con scopeAll', async () => {
    const db = makeQueueDb([]);
    await expect(
      assertTargetInScope(db as Database, makeScope({ scopeAll: true }), {
        assessmentId: 'as-1',
      }),
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
      makeScope({ scopeAll: true }),
      'st-1',
    );
    expect(visible).toBe(false);
  });

  it('scopeAll ve a cualquier alumno de la org', async () => {
    const db = makeQueueDb([[{ id: 'st-1' }]]);
    const visible = await isStudentVisibleInScope(
      db as Database,
      'org-1',
      makeScope({ scopeAll: true }),
      'st-1',
    );
    expect(visible).toBe(true);
  });

  it('un profesor sin cursos no ve a ningún alumno', async () => {
    const db = makeQueueDb([[{ id: 'st-1' }]]);
    const visible = await isStudentVisibleInScope(db as Database, 'org-1', makeScope({}), 'st-1');
    expect(visible).toBe(false);
  });

  it('visible sólo si tiene matrícula en un curso del alcance', async () => {
    const conMatricula = makeQueueDb([[{ id: 'st-1' }], [{ id: 'en-1' }]]);
    await expect(
      isStudentVisibleInScope(
        conMatricula as Database,
        'org-1',
        makeScope({ classGroupIds: ['cg-propio'] }),
        'st-1',
      ),
    ).resolves.toBe(true);

    const sinMatricula = makeQueueDb([[{ id: 'st-1' }], []]);
    await expect(
      isStudentVisibleInScope(
        sinMatricula as Database,
        'org-1',
        makeScope({ classGroupIds: ['cg-propio'] }),
        'st-1',
      ),
    ).resolves.toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Fase 1: alcance por ASIGNATURA + jefatura de curso transversal.
// ──────────────────────────────────────────────────────────────────────────────

describe('resolveClassGroupScope — pares curso × asignatura', () => {
  it('un profesor obtiene un par por cada (curso, asignatura) que dicta', async () => {
    const db = makeQueueDb([
      [
        { classGroupId: 'cg-1', subjectId: 'MATH' },
        { classGroupId: 'cg-1', subjectId: 'SCI' },
        { classGroupId: 'cg-2', subjectId: 'MATH' },
        { classGroupId: 'cg-1', subjectId: 'MATH' }, // duplicado
      ],
    ]);
    const scope = await resolveClassGroupScope(db as Database, makeScopedUser(), 'org-1');

    expect(scope.pairs).toHaveLength(3);
    expect(scope.classGroupIds.sort()).toEqual(['cg-1', 'cg-2']);
    expect(scope.homeroomClassGroupIds).toEqual([]);
  });

  it('un profesor jefe suma sus cursos de jefatura, validados contra la org', async () => {
    const db = makeQueueDb([
      [{ classGroupId: 'cg-mate', subjectId: 'MATH' }], // dicta Matemática en cg-mate
      [{ scope: { classGroupIds: ['cg-jefatura', 'cg-de-otra-org'] } }], // membership
      [{ id: 'cg-jefatura' }], // sólo cg-jefatura pertenece a la org
    ]);
    const scope = await resolveClassGroupScope(
      db as Database,
      makeScopedUser({ roles: ['teacher', 'homeroom_teacher'], activeRole: 'homeroom_teacher' }),
      'org-1',
    );

    expect(scope.homeroomClassGroupIds).toEqual(['cg-jefatura']);
    expect(scope.classGroupIds.sort()).toEqual(['cg-jefatura', 'cg-mate']);
  });

  it('un membership de jefatura sin cursos declarados no da acceso', async () => {
    const db = makeQueueDb([[{ classGroupId: 'cg-mate', subjectId: 'MATH' }], [{ scope: null }]]);
    const scope = await resolveClassGroupScope(
      db as Database,
      makeScopedUser({ roles: ['homeroom_teacher'], activeRole: 'homeroom_teacher' }),
      'org-1',
    );
    expect(scope.homeroomClassGroupIds).toEqual([]);
  });
});

describe('isAssessmentInScope', () => {
  const profeMate = makeScope({ pairs: [{ classGroupId: 'cg-1', subjectId: 'MATH' }] });
  const jefeDeCurso = makeScope({ homeroomClassGroupIds: ['cg-1'] });

  it('el profesor de Matemática de 2°A ve la evaluación de Matemática de 2°A', () => {
    expect(isAssessmentInScope(profeMate, { classGroupIds: ['cg-1'], subjectId: 'MATH' })).toBe(
      true,
    );
  });

  it('...y NO ve la de Lenguaje del mismo curso — el bug que motivó la fase', () => {
    expect(isAssessmentInScope(profeMate, { classGroupIds: ['cg-1'], subjectId: 'LANG' })).toBe(
      false,
    );
  });

  it('...ni la de su asignatura en otro curso', () => {
    expect(isAssessmentInScope(profeMate, { classGroupIds: ['cg-2'], subjectId: 'MATH' })).toBe(
      false,
    );
  });

  it('el profesor jefe ve TODAS las asignaturas de su curso', () => {
    expect(isAssessmentInScope(jefeDeCurso, { classGroupIds: ['cg-1'], subjectId: 'LANG' })).toBe(
      true,
    );
    expect(isAssessmentInScope(jefeDeCurso, { classGroupIds: ['cg-1'], subjectId: 'SCI' })).toBe(
      true,
    );
  });

  it('...pero ninguna de otro curso', () => {
    expect(isAssessmentInScope(jefeDeCurso, { classGroupIds: ['cg-2'], subjectId: 'LANG' })).toBe(
      false,
    );
  });

  it('una evaluación multicurso entra si ALGUNO de sus cursos está en el alcance', () => {
    expect(
      isAssessmentInScope(profeMate, { classGroupIds: ['cg-9', 'cg-1'], subjectId: 'MATH' }),
    ).toBe(true);
  });

  it('una evaluación sin cursos asignados no entra en un alcance acotado', () => {
    expect(isAssessmentInScope(profeMate, { classGroupIds: [], subjectId: 'MATH' })).toBe(false);
  });

  it('scopeAll ve cualquier evaluación', () => {
    expect(
      isAssessmentInScope(makeScope({ scopeAll: true }), { classGroupIds: [], subjectId: null }),
    ).toBe(true);
  });
});
