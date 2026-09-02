/**
 * Aislamiento por docente en análisis IA (Fase 2 del plan de alcance docente).
 *
 * Antes de este cambio el service filtraba SOLO por `org_id`: un profesor podía
 * leer el análisis de cualquier curso de la organización pasando su id. Estos
 * tests fijan que el alcance se contrasta contra `teacher_assignments`.
 */
import { ForbiddenException } from '@nestjs/common';
import type { Database } from '@soe/db';
import { AiAnalysisService } from './ai-analysis.service';
import { makeQueueDb, makeScopedUser } from '../common/helpers/scope-test-utils';

function makeService(db: Database): AiAnalysisService {
  return new (AiAnalysisService as new (db: Database) => AiAnalysisService)(db);
}

function analysisRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a-1',
    orgId: 'org-1',
    assessmentId: 'as-1',
    classGroupId: 'cg-ajeno',
    analysisType: 'assessment_insights',
    audience: 'teacher',
    status: 'completed',
    model: 'gemini',
    promptVersion: 'v1',
    inputHash: 'hash',
    input: null,
    output: { summary: 'ok' },
    tokens: null,
    costUsd: null,
    error: null,
    createdById: 'user-1',
    startedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('AiAnalysisService — alcance docente', () => {
  it('get(): rechaza un análisis de un curso fuera del alcance del profesor', async () => {
    const db = makeQueueDb([
      [analysisRow({ classGroupId: 'cg-ajeno' })], // la fila existe en la org
      [{ classGroupId: 'cg-propio' }], // teacher_assignments del profesor
    ]);

    await expect(makeService(db).get(makeScopedUser(), 'a-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('get(): devuelve el análisis de un curso propio', async () => {
    const db = makeQueueDb([
      [analysisRow({ classGroupId: 'cg-propio' })],
      [{ classGroupId: 'cg-propio' }],
    ]);

    const res = await makeService(db).get(makeScopedUser(), 'a-1');
    expect(res.id).toBe('a-1');
  });

  it('get(): un análisis sin curso exige que TODOS los cursos de la evaluación estén en el alcance', async () => {
    const db = makeQueueDb([
      [analysisRow({ classGroupId: null })],
      [{ classGroupId: 'cg-propio' }], // alcance del profesor
      [{ classGroupId: 'cg-propio' }, { classGroupId: 'cg-ajeno' }], // cursos de la evaluación
    ]);

    await expect(makeService(db).get(makeScopedUser(), 'a-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('get(): un directivo no consulta teacher_assignments y ve cualquier curso', async () => {
    const db = makeQueueDb([[analysisRow({ classGroupId: 'cg-ajeno' })]]);

    const res = await makeService(db).get(
      makeScopedUser({ roles: ['academic_director'], activeRole: 'academic_director' }),
      'a-1',
    );
    expect(res.id).toBe('a-1');
    expect(db.__remaining()).toBe(0);
  });

  it('create(): rechaza generar sobre un curso ajeno aunque venga en el DTO', async () => {
    const db = makeQueueDb([[{ classGroupId: 'cg-propio' }]]);

    await expect(
      makeService(db).create(makeScopedUser(), 'as-1', {
        analysisType: 'assessment_insights',
        audience: 'teacher',
        classGroupId: 'cg-ajeno',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('findLatestForAssessment(): rechaza el scope de un curso ajeno', async () => {
    const db = makeQueueDb([[{ classGroupId: 'cg-propio' }]]);

    await expect(
      makeService(db).findLatestForAssessment(makeScopedUser(), {
        assessmentId: 'as-1',
        analysisType: 'assessment_insights',
        audience: 'teacher',
        classGroupId: 'cg-ajeno',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('un profesor sin asignaciones no alcanza ningún análisis', async () => {
    const db = makeQueueDb([[analysisRow({ classGroupId: 'cg-x' })], []]);

    await expect(makeService(db).get(makeScopedUser(), 'a-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
