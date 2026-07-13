import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Database, RemedialMaterial } from '@soe/db';
import type {
  GenerateRemedialDto,
  RemedialPracticeContent,
  ReviewRemedialDto,
  UserRole,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { RemedialService } from './remedial.service';

// ──────────────────────────────────────────────────────────────────────────────
// Mock DB (patrón de ai-analysis.service.spec.ts). Las queries corren dentro de
// withOrgContext → db.transaction(cb), que el mock reentra con el mismo db.
// ──────────────────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  const role: UserRole = overrides.activeRole ?? overrides.role ?? 'school_admin';
  return {
    userId: 'user-1',
    orgId: 'org-1',
    email: 't@x.cl',
    name: 'Tester',
    isPlatformAdmin: role === 'platform_admin',
    roles: [role],
    activeRole: role,
    role,
    ...overrides,
  };
}

function makeRow(overrides: Partial<RemedialMaterial> = {}): RemedialMaterial {
  return {
    id: 'mat-1',
    orgId: 'org-1',
    type: 'guide',
    method: 'self_contained',
    status: 'pending',
    nodeId: 'node-1',
    assessmentId: null,
    classGroupId: null,
    sourceAnalysisId: null,
    title: null,
    content: null,
    editedContent: null,
    qualityReport: null,
    input: null,
    inputHash: 'hash-1',
    model: null,
    promptVersion: null,
    tokens: null,
    costUsd: null,
    error: null,
    createdById: 'user-1',
    reviewedById: null,
    startedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: null,
    reviewedAt: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

type SelectChain = {
  from: (..._: unknown[]) => SelectChain;
  innerJoin: (..._: unknown[]) => SelectChain;
  where: (..._: unknown[]) => SelectChain;
  orderBy: (..._: unknown[]) => SelectChain;
  limit: (..._: unknown[]) => SelectChain & Promise<unknown[]>;
  offset: (..._: unknown[]) => Promise<unknown[]>;
  then: (resolve: (rows: unknown[]) => unknown) => unknown;
};

type DbMock = Database & {
  __inserted: Array<Record<string, unknown>>;
  __updates: Array<Record<string, unknown>>;
};

/**
 * `selectResults` se consume en orden FIFO por cada `db.select()`. Un chain es
 * thenable y resoluble vía `.limit()`/`.offset()` para cubrir las variantes.
 */
function makeDb(
  selectResults: unknown[][],
  insertReturning: unknown[][] = [],
): DbMock {
  let selectIdx = 0;
  let insertIdx = 0;
  const inserted: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];

  const makeSelect = (): SelectChain => {
    const rows = selectResults[selectIdx] ?? [];
    selectIdx++;
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      offset: () => Promise.resolve(rows),
      then: (resolve: (r: unknown[]) => unknown) => resolve(rows),
    } as unknown as SelectChain;
    return chain;
  };

  const db = {
    select: () => makeSelect(),
    insert: () => ({
      values: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        arr.forEach((r) => inserted.push(r));
        const ret = insertReturning[insertIdx] ?? arr.map((r) => ({ ...r, id: 'new-id' }));
        insertIdx++;
        return { returning: () => Promise.resolve(ret) };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return { where: () => Promise.resolve({}) };
      },
    }),
    execute: async () => [],
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    __inserted: inserted,
    __updates: updates,
  } as unknown as DbMock;

  return db;
}

const baseDto: GenerateRemedialDto = {
  type: 'guide',
  nodeId: '11111111-1111-1111-1111-111111111111',
  force: false,
};

describe('RemedialService', () => {
  it('lanza ForbiddenException si el usuario no tiene orgId', async () => {
    const service = new RemedialService(makeDb([]));
    const user = makeUser({ orgId: null });
    await expect(service.create(user, baseDto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('create inserta un registro pending cuando no hay caché (fromCache=false)', async () => {
    // 1) lookup de caché (vacío), 2) toModel nodeName lookup
    const db = makeDb(
      [[], [{ name: 'OA 3' }]],
      [[makeRow({ id: 'mat-new' })]],
    );
    const service = new RemedialService(db);
    const result = await service.create(makeUser(), baseDto);

    expect(result.fromCache).toBe(false);
    expect(result.material.status).toBe('pending');
    expect(db.__inserted).toHaveLength(1);
    expect(db.__inserted[0]).toMatchObject({ status: 'pending', type: 'guide' });
  });

  it('create persiste itemCount en input para practice_set (determinista)', async () => {
    const db = makeDb([[], [{ name: 'OA' }]], [[makeRow({ type: 'practice_set' })]]);
    const service = new RemedialService(db);
    await service.create(makeUser(), {
      type: 'practice_set',
      nodeId: '11111111-1111-1111-1111-111111111111',
      itemCount: 8,
      force: false,
    });
    expect(db.__inserted[0]).toMatchObject({ input: { itemCount: 8 } });
  });

  it('create reutiliza una fila ready como caché (fromCache=true)', async () => {
    const cached = makeRow({ id: 'mat-cached', status: 'ready' });
    const db = makeDb([[cached], [{ name: 'OA' }]]);
    const service = new RemedialService(db);
    const result = await service.create(makeUser(), baseDto);

    expect(result.fromCache).toBe(true);
    expect(result.material.id).toBe('mat-cached');
    expect(db.__inserted).toHaveLength(0);
  });

  it('create ignora la caché cuando force=true', async () => {
    const cached = makeRow({ id: 'mat-cached', status: 'ready' });
    const db = makeDb([[cached], [{ name: 'OA' }]], [[makeRow({ id: 'mat-forced' })]]);
    const service = new RemedialService(db);
    const result = await service.create(makeUser(), { ...baseDto, force: true });

    expect(result.fromCache).toBe(false);
    expect(db.__inserted).toHaveLength(1);
  });

  it('NO usa como caché una fila failed (regenera)', async () => {
    const failed = makeRow({ id: 'mat-failed', status: 'failed' });
    const db = makeDb([[failed], [{ name: 'OA' }]], [[makeRow({ id: 'mat-retry' })]]);
    const service = new RemedialService(db);
    const result = await service.create(makeUser(), baseDto);
    expect(result.fromCache).toBe(false);
  });

  it('get lanza NotFound si no existe', async () => {
    const db = makeDb([[]]);
    const service = new RemedialService(db);
    await expect(service.get(makeUser(), 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('toModel arma el Model con nodeName joineado y shape exacto', async () => {
    const row = makeRow({ status: 'ready', nodeId: 'node-9' });
    const db = makeDb([[row], [{ name: 'Comprensión lectora' }]]);
    const service = new RemedialService(db);
    const model = await service.get(makeUser(), 'mat-1');

    expect(model.nodeName).toBe('Comprensión lectora');
    expect(Object.keys(model).sort()).toEqual(
      [
        'assessmentId',
        'classGroupId',
        'completedAt',
        'content',
        'editedContent',
        'costUsd',
        'createdAt',
        'createdById',
        'error',
        'id',
        'method',
        'model',
        'nodeId',
        'nodeName',
        'orgId',
        'promptVersion',
        'qualityReport',
        'reviewedAt',
        'reviewedById',
        'status',
        'title',
        'type',
      ].sort(),
    );
  });

  it('markReady persiste content + trazabilidad y estado ready', async () => {
    const db = makeDb([]);
    const service = new RemedialService(db);
    await service.markReady('mat-1', 'org-1', {
      content: {
        objective: 'o',
        rootCauseSummary: 'r',
        strategy: 's',
        classActivities: [{ title: 't', description: 'd', durationMin: 30 }],
        materials: [],
        successCriteria: [],
      },
      input: { curriculum: { nodeId: 'node-1' } },
      method: 'self_contained',
      model: 'gemini',
      promptVersion: 's3-guide-v1',
      tokens: { input: 10, output: 20 },
      costUsd: '0.01',
    });
    expect(db.__updates[0]).toMatchObject({
      status: 'ready',
      method: 'self_contained',
      promptVersion: 's3-guide-v1',
    });
  });

  it('markFailed setea status failed con el error', async () => {
    const db = makeDb([]);
    const service = new RemedialService(db);
    await service.markFailed('mat-1', 'org-1', 'boom');
    expect(db.__updates[0]).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('review rechaza si el material no está ready', async () => {
    const row = makeRow({ status: 'approved' });
    const db = makeDb([[row]]);
    const service = new RemedialService(db);
    const dto: ReviewRemedialDto = { action: 'approve' };
    await expect(service.review(makeUser(), 'mat-1', dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('review discard marca discarded y sella reviewer', async () => {
    const ready = makeRow({ status: 'ready' });
    const discarded = makeRow({ status: 'discarded', reviewedById: 'user-1' });
    // 1) findOne inicial, 2) findOne final, 3) nodeName lookup
    const db = makeDb([[ready], [discarded], [{ name: 'OA' }]]);
    const service = new RemedialService(db);
    const model = await service.review(makeUser(), 'mat-1', { action: 'discard' });

    expect(model.status).toBe('discarded');
    expect(db.__updates[0]).toMatchObject({ status: 'discarded', reviewedById: 'user-1' });
  });

  it('review approve de practice_set publica los ítems referenciados', async () => {
    const practiceContent: RemedialPracticeContent = {
      skillFocus: 'fracciones',
      itemCount: 2,
      items: [
        { itemId: '22222222-2222-2222-2222-222222222222', position: 1, stem: 'a' },
        { itemId: '33333333-3333-3333-3333-333333333333', position: 2, stem: 'b' },
      ],
      notes: null,
      stimuli: [],
    };
    const ready = makeRow({
      status: 'ready',
      type: 'practice_set',
      content: practiceContent,
    });
    const approved = makeRow({ status: 'approved', type: 'practice_set', content: practiceContent });
    // 1) findOne inicial, 2) findOne final, 3) nodeName lookup
    const db = makeDb([[ready], [approved], [{ name: 'OA' }]]);
    const service = new RemedialService(db);
    const model = await service.review(makeUser(), 'mat-1', { action: 'approve' });

    expect(model.status).toBe('approved');
    // dos updates: el material (approved) + los ítems (published)
    const publishUpdate = db.__updates.find((u) => u.status === 'published');
    expect(publishUpdate).toBeDefined();
  });

  it('review approve con content editado lo persiste en editedContent, NO en content (§8.3)', async () => {
    const aiContent = {
      objective: 'ai',
      rootCauseSummary: 'r',
      strategy: 's',
      classActivities: [{ title: 't', description: 'd', durationMin: 30 }],
      materials: [],
      successCriteria: [],
    };
    const edited = { ...aiContent, objective: 'humano editó' };
    const ready = makeRow({ status: 'ready', content: aiContent });
    const approved = makeRow({ status: 'approved', content: aiContent, editedContent: edited });
    const db = makeDb([[ready], [approved], [{ name: 'OA' }]]);
    const service = new RemedialService(db);

    await service.review(makeUser(), 'mat-1', { action: 'approve', content: edited });

    const approveUpdate = db.__updates.find((u) => u.status === 'approved');
    expect(approveUpdate).toMatchObject({ editedContent: edited });
    // la evidencia IA (content) NO se toca en el approve
    expect(approveUpdate).not.toHaveProperty('content');
  });

  it('update edita cualquier tipo (group_plan) y persiste en editedContent (no content)', async () => {
    const planContent = {
      groupLabel: 'Grupo A',
      studentCount: 4,
      sharedGap: 'fracciones',
      sequence: [{ order: 1, title: 'p1', description: 'd1', linkedNodeId: null }],
      estimatedSessions: 2,
    };
    const ready = makeRow({ status: 'ready', type: 'group_plan', content: null });
    const updatedRow = makeRow({ status: 'ready', type: 'group_plan', editedContent: planContent });
    // 1) findOne inicial, 2) findOne final, 3) nodeName lookup
    const db = makeDb([[ready], [updatedRow], [{ name: 'OA' }]]);
    const service = new RemedialService(db);

    const model = await service.update(makeUser(), 'mat-1', { content: planContent });

    expect(db.__updates[0]).toMatchObject({ editedContent: planContent });
    expect(db.__updates[0]).not.toHaveProperty('content');
    expect(model.editedContent).toMatchObject({ groupLabel: 'Grupo A' });
  });

  it('update rechaza si el material no está en ready', async () => {
    const approved = makeRow({ status: 'approved' });
    const db = makeDb([[approved]]);
    const service = new RemedialService(db);
    await expect(
      service.update(makeUser(), 'mat-1', { title: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('getStudentVersion deriva el render sin info solo-profesor (guide)', async () => {
    const guide = {
      objective: 'Reforzar inferencias',
      rootCauseSummary: 'diagnóstico interno',
      strategy: 'modelado docente',
      classActivities: [{ title: 'Actividad 1', description: 'leer', durationMin: 20 }],
      materials: ['texto'],
      successCriteria: ['logra inferir'],
    };
    const row = makeRow({ status: 'approved', content: guide });
    const db = makeDb([[row], [{ name: 'Comprensión' }]]);
    const service = new RemedialService(db);

    const student = await service.getStudentVersion(makeUser(), 'mat-1');

    expect(student.content).toEqual({
      objective: 'Reforzar inferencias',
      classActivities: [{ title: 'Actividad 1', description: 'leer', durationMin: 20 }],
      materials: ['texto'],
    });
    // no filtra información solo-profesor
    expect(student.content).not.toHaveProperty('rootCauseSummary');
    expect(student.content).not.toHaveProperty('strategy');
    expect(student.content).not.toHaveProperty('successCriteria');
  });

  it('getStudentVersion prefiere editedContent sobre content (efectivo)', async () => {
    const ai = {
      objective: 'IA',
      rootCauseSummary: 'r',
      strategy: 's',
      classActivities: [{ title: 'a', description: 'd', durationMin: null }],
      materials: [],
      successCriteria: [],
    };
    const edited = { ...ai, objective: 'editado por humano' };
    const row = makeRow({ status: 'approved', content: ai, editedContent: edited });
    const db = makeDb([[row], [{ name: 'OA' }]]);
    const service = new RemedialService(db);

    const student = await service.getStudentVersion(makeUser(), 'mat-1');
    expect(student.content).toMatchObject({ objective: 'editado por humano' });
  });

  it('getStudentVersion devuelve content null si el material no tiene salida', async () => {
    const row = makeRow({ status: 'pending', content: null });
    const db = makeDb([[row], [{ name: 'OA' }]]);
    const service = new RemedialService(db);
    const student = await service.getStudentVersion(makeUser(), 'mat-1');
    expect(student.content).toBeNull();
  });

  it('get hidrata practiceItems on-read para practice_set ready (sin persistir)', async () => {
    const practiceContent: RemedialPracticeContent = {
      skillFocus: 'fracciones',
      itemCount: 1,
      items: [{ itemId: '22222222-2222-2222-2222-222222222222', position: 1, stem: 'a' }],
      notes: null,
      stimuli: [],
    };
    const row = makeRow({ status: 'ready', type: 'practice_set', content: practiceContent });
    const itemRow = {
      id: '22222222-2222-2222-2222-222222222222',
      type: 'multiple_choice',
      content: {
        stem: '¿Cuál es equivalente a 1/2?',
        alternatives: [
          { key: 'A', text: '2/4', isCorrect: true },
          { key: 'B', text: '1/3', isCorrect: false },
        ],
        explanation: '2/4 simplifica a 1/2',
      },
    };
    // 1) findOne, 2) nodeName (toModel), 3) items (hidratación)
    const db = makeDb([[row], [{ name: 'OA' }], [itemRow]]);
    const service = new RemedialService(db);
    const model = await service.get(makeUser(), 'mat-1');

    expect(model.practiceItems).toHaveLength(1);
    expect(model.practiceItems?.[0]).toMatchObject({
      itemId: '22222222-2222-2222-2222-222222222222',
      position: 1,
      type: 'multiple_choice',
      stem: '¿Cuál es equivalente a 1/2?',
      correctKey: 'A',
      explanation: '2/4 simplifica a 1/2',
    });
    expect(model.practiceItems?.[0]?.alternatives).toHaveLength(2);
    // on-read: no se persiste nada.
    expect(db.__updates).toHaveLength(0);
  });

  it('get NO hidrata practiceItems para guide (queda undefined)', async () => {
    const row = makeRow({ status: 'ready', type: 'guide' });
    const db = makeDb([[row], [{ name: 'OA' }]]);
    const service = new RemedialService(db);
    const model = await service.get(makeUser(), 'mat-1');
    expect(model.practiceItems).toBeUndefined();
  });

  it('create persiste method + stimulusId (Ola 2.1a) para el modo con estímulo', async () => {
    const db = makeDb(
      [[], [{ name: 'OA' }]],
      [[makeRow({ type: 'practice_set', method: 'reuse_stimulus' })]],
    );
    const service = new RemedialService(db);
    await service.create(makeUser(), {
      type: 'practice_set',
      nodeId: '11111111-1111-1111-1111-111111111111',
      assessmentId: '44444444-4444-4444-4444-444444444444',
      itemCount: 3,
      method: 'reuse_stimulus',
      stimulusId: '55555555-5555-4555-8555-555555555555',
      force: false,
    });
    // method va a la columna; stimulusId al input determinista (lo lee el runner).
    expect(db.__inserted[0]).toMatchObject({
      method: 'reuse_stimulus',
      input: { itemCount: 3, stimulusId: '55555555-5555-4555-8555-555555555555' },
    });
  });

  it('get hidrata stimuli on-read para practice_set con estímulo (sin persistir)', async () => {
    const practiceContent: RemedialPracticeContent = {
      skillFocus: 'comprensión',
      itemCount: 1,
      items: [{ itemId: '22222222-2222-2222-2222-222222222222', position: 1, stem: 'a' }],
      notes: null,
      stimuli: [
        {
          sectionId: '66666666-6666-4666-8666-666666666666',
          kind: 'passage',
          source: 'official',
          title: 'La abeja',
          textPreview: 'Las abejas…',
        },
      ],
    };
    const row = makeRow({ status: 'ready', type: 'practice_set', content: practiceContent });
    const itemRow = {
      id: '22222222-2222-2222-2222-222222222222',
      type: 'multiple_choice',
      content: { stem: 'q', alternatives: [{ key: 'A', text: 'x', isCorrect: true }] },
    };
    const sectionRow = {
      id: '66666666-6666-4666-8666-666666666666',
      kind: 'passage',
      source: 'official',
      passageTitle: 'La abeja',
      passageText: 'Las abejas polinizan las flores y producen miel.',
    };
    // 1) findOne, 2) nodeName (toModel), 3) items (hidratación), 4) sections (estímulo)
    const db = makeDb([[row], [{ name: 'OA' }], [itemRow], [sectionRow]]);
    const service = new RemedialService(db);
    const model = await service.get(makeUser(), 'mat-1');

    // El estímulo trae el TEXTO COMPLETO re-hidratado (no el preview del content).
    expect(model.stimuli).toHaveLength(1);
    expect(model.stimuli?.[0]).toMatchObject({
      sectionId: '66666666-6666-4666-8666-666666666666',
      kind: 'passage',
      source: 'official',
      title: 'La abeja',
      text: 'Las abejas polinizan las flores y producen miel.',
    });
    // on-read: no se persiste nada.
    expect(db.__updates).toHaveLength(0);
  });
});
