import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Database, RemedialMaterial } from '@soe/db';
import type {
  GenerateRemedialDto,
  RemedialPracticeContent,
  ReviewRemedialDto,
  UpdateRemedialItemDto,
  UpdateRemedialStimulusDto,
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

  // ── updateItem / removeItem (Ola 1‑resto G2) ───────────────────────────────
  const ITEM_A = '22222222-2222-2222-2222-222222222222';
  const ITEM_B = '33333333-3333-3333-3333-333333333333';

  function practiceContent(
    refs: RemedialPracticeContent['items'],
  ): RemedialPracticeContent {
    return {
      skillFocus: 'fracciones',
      itemCount: refs.length,
      items: refs,
      notes: null,
      stimuli: [],
    };
  }

  const validUpdate: UpdateRemedialItemDto = {
    stem: 'Nuevo enunciado',
    alternatives: [
      { key: 'A', text: '2/4', isCorrect: false },
      { key: 'B', text: '1/3', isCorrect: true },
    ],
    explanation: 'nueva explicación',
  };

  it('updateItem persiste el content (preservando imageUrl) y actualiza el stem del ref', async () => {
    const content = practiceContent([
      { itemId: ITEM_A, position: 1, stem: 'viejo A' },
      { itemId: ITEM_B, position: 2, stem: 'viejo B' },
    ]);
    const material = makeRow({ status: 'ready', type: 'practice_set', content });
    const itemRow = {
      id: ITEM_A,
      type: 'multiple_choice',
      content: {
        stem: 'viejo A',
        imageUrl: 'https://cdn.example.com/a.png',
        alternatives: [
          { key: 'A', text: '2/4', isCorrect: true },
          { key: 'B', text: '1/3', isCorrect: false },
        ],
        explanation: 'exp vieja',
      },
    };
    // 1) findOne(material), 2) item lookup (draft)
    const db = makeDb([[material], [itemRow]]);
    const service = new RemedialService(db);

    const preview = await service.updateItem('org-1', 'mat-1', ITEM_A, validUpdate);

    expect(preview).toMatchObject({
      itemId: ITEM_A,
      position: 1,
      type: 'multiple_choice',
      stem: 'Nuevo enunciado',
      correctKey: 'B',
      explanation: 'nueva explicación',
    });
    // items.content: preserva imageUrl, sobrescribe stem/alternatives/explanation.
    const itemUpdate = db.__updates.find(
      (u) => u.content && typeof u.content === 'object' && 'stem' in u.content,
    );
    expect(itemUpdate?.content).toMatchObject({
      stem: 'Nuevo enunciado',
      imageUrl: 'https://cdn.example.com/a.png',
      explanation: 'nueva explicación',
    });
    // material.content: el ref del ítem editado refleja el nuevo stem (preview ligero).
    const matUpdate = db.__updates.find(
      (u) => u.content && typeof u.content === 'object' && 'items' in u.content,
    );
    const refs = (matUpdate!.content as RemedialPracticeContent).items;
    expect(refs.find((r) => r.itemId === ITEM_A)?.stem).toBe('Nuevo enunciado');
    expect(refs.find((r) => r.itemId === ITEM_B)?.stem).toBe('viejo B');
  });

  it('updateItem rechaza (400) con dos alternativas correctas', async () => {
    const service = new RemedialService(makeDb([]));
    const dto: UpdateRemedialItemDto = {
      stem: 's',
      alternatives: [
        { key: 'A', text: 'a', isCorrect: true },
        { key: 'B', text: 'b', isCorrect: true },
      ],
    };
    await expect(
      service.updateItem('org-1', 'mat-1', ITEM_A, dto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updateItem rechaza (400) con ninguna alternativa correcta', async () => {
    const service = new RemedialService(makeDb([]));
    const dto: UpdateRemedialItemDto = {
      stem: 's',
      alternatives: [
        { key: 'A', text: 'a', isCorrect: false },
        { key: 'B', text: 'b', isCorrect: false },
      ],
    };
    await expect(
      service.updateItem('org-1', 'mat-1', ITEM_A, dto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updateItem rechaza (400) si el material no está ready', async () => {
    const content = practiceContent([{ itemId: ITEM_A, position: 1, stem: 'a' }]);
    const material = makeRow({ status: 'approved', type: 'practice_set', content });
    const db = makeDb([[material]]);
    const service = new RemedialService(db);
    await expect(
      service.updateItem('org-1', 'mat-1', ITEM_A, validUpdate),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updateItem rechaza (NotFound) si el ítem no es un draft de la org', async () => {
    const content = practiceContent([{ itemId: ITEM_A, position: 1, stem: 'a' }]);
    const material = makeRow({ status: 'ready', type: 'practice_set', content });
    // 1) findOne(material) ok, 2) item lookup vacío (otra org / ya publicado / borrado).
    const db = makeDb([[material], []]);
    const service = new RemedialService(db);
    await expect(
      service.updateItem('org-1', 'mat-1', ITEM_A, validUpdate),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updateItem rechaza (NotFound) si el ítem no pertenece al set', async () => {
    const content = practiceContent([{ itemId: ITEM_B, position: 1, stem: 'b' }]);
    const material = makeRow({ status: 'ready', type: 'practice_set', content });
    const db = makeDb([[material]]);
    const service = new RemedialService(db);
    await expect(
      service.updateItem('org-1', 'mat-1', ITEM_A, validUpdate),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removeItem quita el ref, soft-deletea el draft y reindexa positions', async () => {
    const content = practiceContent([
      { itemId: ITEM_A, position: 1, stem: 'a' },
      { itemId: ITEM_B, position: 2, stem: 'b' },
    ]);
    const material = makeRow({ status: 'ready', type: 'practice_set', content });
    const updated = makeRow({
      status: 'ready',
      type: 'practice_set',
      content: practiceContent([{ itemId: ITEM_B, position: 1, stem: 'b' }]),
    });
    const remainingItem = {
      id: ITEM_B,
      type: 'multiple_choice',
      content: {
        stem: 'b',
        alternatives: [
          { key: 'A', text: 'a', isCorrect: true },
          { key: 'B', text: 'b', isCorrect: false },
        ],
      },
    };
    // 1) findOne(material), 2) item lookup, 3) findOne(updated), 4) nodeName, 5) hidratación
    const db = makeDb([
      [material],
      [{ id: ITEM_A }],
      [updated],
      [{ name: 'OA' }],
      [remainingItem],
    ]);
    const service = new RemedialService(db);

    const model = await service.removeItem('org-1', 'mat-1', ITEM_A);

    // material.content: solo queda ITEM_B, reindexado a position 1 e itemCount 1.
    const matUpdate = db.__updates.find(
      (u) => u.content && typeof u.content === 'object' && 'items' in u.content,
    );
    const next = matUpdate!.content as RemedialPracticeContent;
    expect(next.items).toEqual([{ itemId: ITEM_B, position: 1, stem: 'b' }]);
    expect(next.itemCount).toBe(1);
    // soft-delete del ítem (nunca DELETE).
    const del = db.__updates.find((u) => u.deletedAt);
    expect(del).toBeDefined();
    expect(model.practiceItems).toHaveLength(1);
  });

  it('removeItem rechaza (400) si dejaría el set vacío', async () => {
    const content = practiceContent([{ itemId: ITEM_A, position: 1, stem: 'a' }]);
    const material = makeRow({ status: 'ready', type: 'practice_set', content });
    const db = makeDb([[material]]);
    const service = new RemedialService(db);
    await expect(
      service.removeItem('org-1', 'mat-1', ITEM_A),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ── updateStimulus (Ola 2.2, Opción B) ─────────────────────────────────────
  const SECTION_ID = '66666666-6666-4666-8666-666666666666';

  const validStimulusUpdate: UpdateRemedialStimulusDto = {
    title: 'Nuevo título',
    text: 'Nuevo texto del pasaje generado por IA.',
  };

  /** Content de un practice_set con UN estímulo `ai_generated` editable (Ola 2.2). */
  function practiceWithStimulus(): RemedialPracticeContent {
    return {
      skillFocus: 'comprensión',
      itemCount: 1,
      items: [{ itemId: ITEM_A, position: 1, stem: 'a' }],
      notes: null,
      stimuli: [
        {
          sectionId: SECTION_ID,
          kind: 'passage',
          source: 'ai_generated',
          title: 'Viejo título',
          textPreview: 'viejo preview',
        },
      ],
    };
  }

  it('updateStimulus actualiza el pasaje ai_generated y re-hidrata el material', async () => {
    const material = makeRow({
      status: 'ready',
      type: 'practice_set',
      content: practiceWithStimulus(),
    });
    const section = {
      id: SECTION_ID,
      kind: 'passage',
      source: 'ai_generated',
      passageTitle: 'Viejo título',
    };
    const updatedRow = makeRow({
      status: 'ready',
      type: 'practice_set',
      content: {
        ...practiceWithStimulus(),
        stimuli: [
          {
            sectionId: SECTION_ID,
            kind: 'passage',
            source: 'ai_generated',
            title: 'Nuevo título',
            textPreview: 'Nuevo texto del pasaje generado por IA.',
          },
        ],
      },
    });
    const itemRow = {
      id: ITEM_A,
      type: 'multiple_choice',
      content: { stem: 'q', alternatives: [{ key: 'A', text: 'x', isCorrect: true }] },
    };
    const updatedSectionRow = {
      id: SECTION_ID,
      kind: 'passage',
      source: 'ai_generated',
      passageTitle: 'Nuevo título',
      passageText: 'Nuevo texto del pasaje generado por IA.',
    };
    // 1) loadStimulusRef→findOne, 2) section load, 3) findOne(updated),
    // 4) nodeName (toModel), 5) items (hidratación), 6) sections (estímulo)
    const db = makeDb([
      [material],
      [section],
      [updatedRow],
      [{ name: 'OA' }],
      [itemRow],
      [updatedSectionRow],
    ]);
    const service = new RemedialService(db);

    const model = await service.updateStimulus('org-1', 'mat-1', validStimulusUpdate);

    // instrument_sections: passageText + passageTitle actualizados (org explícito).
    const sectionUpdate = db.__updates.find((u) => 'passageText' in u);
    expect(sectionUpdate).toMatchObject({
      passageText: 'Nuevo texto del pasaje generado por IA.',
      passageTitle: 'Nuevo título',
    });
    // material.content: el ref ligero refleja el nuevo título + preview.
    const matUpdate = db.__updates.find(
      (u) => u.content && typeof u.content === 'object' && 'stimuli' in u.content,
    );
    const nextStimuli = (matUpdate!.content as RemedialPracticeContent).stimuli;
    expect(nextStimuli[0]).toMatchObject({
      sectionId: SECTION_ID,
      title: 'Nuevo título',
      textPreview: 'Nuevo texto del pasaje generado por IA.',
    });
    // re-hidratado: el estímulo trae el TEXTO COMPLETO desde instrument_sections.
    expect(model.stimuli).toHaveLength(1);
    expect(model.stimuli?.[0]).toMatchObject({
      sectionId: SECTION_ID,
      source: 'ai_generated',
      title: 'Nuevo título',
      text: 'Nuevo texto del pasaje generado por IA.',
    });
    expect(model.practiceItems).toHaveLength(1);
  });

  it('updateStimulus preserva el título si el DTO no lo trae (solo texto)', async () => {
    const material = makeRow({
      status: 'ready',
      type: 'practice_set',
      content: practiceWithStimulus(),
    });
    const section = {
      id: SECTION_ID,
      kind: 'passage',
      source: 'ai_generated',
      passageTitle: 'Viejo título',
    };
    const updatedRow = makeRow({
      status: 'ready',
      type: 'practice_set',
      content: practiceWithStimulus(),
    });
    const sectionRow = {
      id: SECTION_ID,
      kind: 'passage',
      source: 'ai_generated',
      passageTitle: 'Viejo título',
      passageText: 'Texto corregido, mismo título.',
    };
    const db = makeDb([
      [material],
      [section],
      [updatedRow],
      [{ name: 'OA' }],
      [],
      [sectionRow],
    ]);
    const service = new RemedialService(db);

    await service.updateStimulus('org-1', 'mat-1', {
      text: 'Texto corregido, mismo título.',
    });

    // title omitido → se preserva el passageTitle actual (no se pone null).
    const sectionUpdate = db.__updates.find((u) => 'passageText' in u);
    expect(sectionUpdate).toMatchObject({
      passageText: 'Texto corregido, mismo título.',
      passageTitle: 'Viejo título',
    });
  });

  it('updateStimulus rechaza (Forbidden) editar un pasaje oficial', async () => {
    const material = makeRow({
      status: 'ready',
      type: 'practice_set',
      content: practiceWithStimulus(),
    });
    const officialSection = {
      id: SECTION_ID,
      kind: 'passage',
      source: 'official',
      passageTitle: 'Pasaje oficial',
    };
    // 1) findOne(material), 2) section load (oficial → rechazo antes de actualizar)
    const db = makeDb([[material], [officialSection]]);
    const service = new RemedialService(db);
    await expect(
      service.updateStimulus('org-1', 'mat-1', validStimulusUpdate),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // no se persistió nada.
    expect(db.__updates).toHaveLength(0);
  });

  it('updateStimulus rechaza (400) si el material no está ready', async () => {
    const material = makeRow({
      status: 'approved',
      type: 'practice_set',
      content: practiceWithStimulus(),
    });
    const db = makeDb([[material]]);
    const service = new RemedialService(db);
    await expect(
      service.updateStimulus('org-1', 'mat-1', validStimulusUpdate),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updateStimulus rechaza (NotFound) si el material es de otra org', async () => {
    // findOne filtra por org_id → vacío para un material de otro tenant.
    const db = makeDb([[]]);
    const service = new RemedialService(db);
    await expect(
      service.updateStimulus('org-1', 'mat-1', validStimulusUpdate),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updateStimulus rechaza (400) si el set no tiene estímulo', async () => {
    const material = makeRow({
      status: 'ready',
      type: 'practice_set',
      content: practiceContent([{ itemId: ITEM_A, position: 1, stem: 'a' }]), // stimuli: []
    });
    const db = makeDb([[material]]);
    const service = new RemedialService(db);
    await expect(
      service.updateStimulus('org-1', 'mat-1', validStimulusUpdate),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
