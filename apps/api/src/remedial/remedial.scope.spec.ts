/**
 * Aislamiento por docente en material remedial (Fase 2 del plan de alcance docente).
 *
 * `generate` aceptaba un `classGroupId` arbitrario del DTO y `get`/`list`
 * filtraban sólo por `org_id`: un profesor podía generar y leer material
 * derivado de las brechas de cursos ajenos. Aquí se fija lo contrario.
 */
import { ForbiddenException } from '@nestjs/common';
import type { Database } from '@soe/db';
import { RemedialService } from './remedial.service';
import { makeQueueDb, makeScopedUser } from '../common/helpers/scope-test-utils';

function makeService(db: Database): RemedialService {
  return new (RemedialService as new (db: Database) => RemedialService)(db);
}

function materialRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'm-1',
    orgId: 'org-1',
    type: 'guide',
    status: 'ready',
    method: 'self_contained',
    nodeId: 'node-1',
    assessmentId: 'as-1',
    classGroupId: 'cg-ajeno',
    sourceAnalysisId: null,
    inputHash: 'hash',
    input: null,
    content: null,
    editedContent: null,
    title: 'Guía',
    createdById: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('RemedialService — alcance docente', () => {
  it('create(): rechaza el classGroupId del DTO si no está en el alcance', async () => {
    const db = makeQueueDb([[{ classGroupId: 'cg-propio' }]]);

    await expect(
      makeService(db).create(makeScopedUser(), {
        type: 'guide',
        nodeId: 'node-1',
        classGroupId: 'cg-ajeno',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('create(): acepta un curso propio', async () => {
    const db = makeQueueDb([
      [{ classGroupId: 'cg-propio' }], // alcance
      [], // caché vacía
    ]);

    const res = await makeService(db).create(makeScopedUser(), {
      type: 'guide',
      nodeId: 'node-1',
      classGroupId: 'cg-propio',
    } as never);
    expect(res.fromCache).toBe(false);
  });

  it('get(): rechaza material de un curso ajeno', async () => {
    const db = makeQueueDb([
      [materialRow({ classGroupId: 'cg-ajeno' })],
      [{ classGroupId: 'cg-propio' }],
    ]);

    await expect(makeService(db).get(makeScopedUser(), 'm-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('getStudentVersion(): rechaza material de un curso ajeno', async () => {
    const db = makeQueueDb([
      [materialRow({ classGroupId: 'cg-ajeno' })],
      [{ classGroupId: 'cg-propio' }],
    ]);

    await expect(makeService(db).getStudentVersion(makeScopedUser(), 'm-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('un directivo genera sobre cualquier curso de la org', async () => {
    // Sin lotes de `teacher_assignments`: un rol admin-like corta el alcance
    // antes de consultarlos. Si el service los consultara, este test fallaría
    // al desalinearse la cola de resultados.
    const db = makeQueueDb([[]]);

    const res = await makeService(db).create(
      makeScopedUser({ roles: ['school_admin'], activeRole: 'school_admin' }),
      { type: 'guide', nodeId: 'node-1', classGroupId: 'cg-cualquiera' } as never,
    );
    expect(res.fromCache).toBe(false);
    expect(res.material.id).toBe('new-id');
  });
});
