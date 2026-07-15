import type { Database } from '@soe/db';
import type {
  QuestionAnalysisResponse,
  AssessmentReportResponse,
  UserRole,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { AssessmentReportService } from '../assessment-report/assessment-report.service';
import { ItemAnalysisService } from '../item-analysis/item-analysis.service';
import { ItemInsightSnapshotService } from './item-insight.snapshot';

// ──────────────────────────────────────────────────────────────────────────────
// Mocks: ItemAnalysisService.getQuestionAnalysis y AssessmentReportService.getReport,
// más un DB mock que secuencia los select() de loadItemMeta / loadPassage /
// loadSectionImages / computePointBiserial. fetch global se stubbea por prueba.
// ──────────────────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  const role: UserRole = 'academic_director';
  return {
    userId: 'u-1',
    orgId: 'org-1',
    email: 't@x.cl',
    name: 'Tester',
    isPlatformAdmin: false,
    roles: [role],
    activeRole: role,
    role,
    ...overrides,
  };
}

/**
 * DB mock: cada select() consume el siguiente bloque de filas de `sequence`. Cada
 * eslabón (`from`/`where`/`orderBy`/`limit`) es a la vez encadenable Y awaitable
 * (thenable), de modo que la query resuelve sin importar en cuál termina
 * (`where`, `orderBy` o `limit`).
 */
function makeDb(sequence: unknown[][]): Database {
  let idx = 0;
  const db = {
    select: () => {
      const rows = sequence[idx] ?? [];
      idx++;
      const link = (): unknown =>
        Object.assign(Promise.resolve(rows), {
          from: () => link(),
          where: () => link(),
          orderBy: () => link(),
          limit: () => Promise.resolve(rows),
        });
      return link();
    },
    execute: async () => undefined,
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
  };
  return db as unknown as Database;
}

function makeQuestion(
  overrides: Partial<QuestionAnalysisResponse> = {},
): QuestionAnalysisResponse {
  return {
    itemId: 'item-1',
    position: 7,
    type: 'multiple_choice',
    stem: '¿Qué quiso decir el autor?',
    imageUrl: null,
    hasFigure: false,
    explanation: null,
    correctKey: 'B',
    skill: { nodeId: 'n-skill', nodeName: 'Inferir', nodeType: 'skill' },
    content: { nodeId: 'n-content', nodeName: 'Comprensión', nodeType: 'content' },
    tags: [
      {
        nodeId: 'n-skill',
        nodeName: 'Inferir',
        nodeType: 'skill',
        nodeCode: null,
        tagType: 'primary',
        taggedBy: 'human',
      },
    ],
    section: null,
    totalResponses: 25,
    blankCount: 1,
    correctCount: 7,
    correctRate: 28,
    alternatives: [
      { key: 'A', text: 'a', isCorrect: false, count: 3, percentage: 12 },
      { key: 'B', text: 'b', isCorrect: true, count: 7, percentage: 28 },
      { key: 'C', text: 'c', isCorrect: false, count: 4, percentage: 16 },
      { key: 'D', text: 'd', isCorrect: false, count: 11, percentage: 44 },
    ],
    ...overrides,
  };
}

function makeReport(): AssessmentReportResponse {
  return {
    meta: { instrumentName: 'DIA Lenguaje' },
    items: [
      {
        itemId: 'item-1',
        position: 7,
        skillName: 'Inferir',
        contentName: 'Comprensión',
        correctKey: 'B',
        answeredCount: 24,
        blankCount: 1,
        totalResponses: 25,
        difficulty: 28, // %
        discrimination: 0.12,
        topDistractorKey: 'D',
        topDistractorRate: 44,
        flags: [],
      },
    ],
  } as unknown as AssessmentReportResponse;
}

function makeService(
  db: Database,
  question: QuestionAnalysisResponse,
  report: AssessmentReportResponse,
): {
  service: ItemInsightSnapshotService;
  getQuestionAnalysis: jest.Mock;
  getReport: jest.Mock;
} {
  const getQuestionAnalysis = jest.fn().mockResolvedValue(question);
  const getReport = jest.fn().mockResolvedValue(report);
  const itemAnalysis = { getQuestionAnalysis } as unknown as ItemAnalysisService;
  const reportService = { getReport } as unknown as AssessmentReportService;
  const service = new (ItemInsightSnapshotService as new (
    db: Database,
    itemAnalysis: ItemAnalysisService,
    reportService: AssessmentReportService,
  ) => ItemInsightSnapshotService)(db, itemAnalysis, reportService);
  return { service, getQuestionAnalysis, getReport };
}

// Secuencia DB para el caso sin sección (sin pasaje ni adjuntos):
//  1) loadItemMeta → items (instrumentId, sectionId=null, content)
//  2) computePointBiserial → items del instrumento
//  3) computePointBiserial → responses
function dbNoSection(opts?: {
  itemMeta?: Record<string, unknown>;
  instrumentItems?: Array<{ itemId: string }>;
  responses?: unknown[];
}): Database {
  return makeDb([
    [
      opts?.itemMeta ?? {
        instrumentId: 'inst-1',
        sectionId: null,
        content: {},
      },
    ],
    opts?.instrumentItems ?? [{ itemId: 'item-1' }, { itemId: 'item-2' }],
    opts?.responses ?? [
      { studentId: 's1', itemId: 'item-1', isCorrect: true },
      { studentId: 's1', itemId: 'item-2', isCorrect: true },
      { studentId: 's2', itemId: 'item-1', isCorrect: false },
      { studentId: 's2', itemId: 'item-2', isCorrect: false },
    ],
  ]);
}

describe('ItemInsightSnapshotService.build', () => {
  it('arma el snapshot reusando getQuestionAnalysis + getReport (psicometría)', async () => {
    const db = dbNoSection();
    const { service, getQuestionAnalysis, getReport } = makeService(
      db,
      makeQuestion(),
      makeReport(),
    );
    const { snapshot, images } = await service.build(makeUser(), 'item-1', {
      assessmentId: 'as-1',
    });

    expect(getQuestionAnalysis).toHaveBeenCalledWith(
      expect.any(Object),
      'item-1',
      { assessmentId: 'as-1', classGroupId: undefined },
    );
    expect(getReport).toHaveBeenCalledWith(expect.any(Object), {
      assessmentId: 'as-1',
      classGroupId: undefined,
    });
    expect(snapshot.itemId).toBe('item-1');
    expect(snapshot.position).toBe(7);
    expect(snapshot.instrumentName).toBe('DIA Lenguaje');
    expect(snapshot.difficulty).toBeCloseTo(0.28); // 28% → 0..1
    expect(snapshot.discrimination).toBe(0.12);
    expect(snapshot.correctKey).toBe('B');
    expect(snapshot.skillName).toBe('Inferir');
    expect(snapshot.passage).toBeNull();
    expect(images).toEqual([]);
  });

  it('deriva el distractor dominante (incorrecta más elegida)', async () => {
    const db = dbNoSection();
    const { service } = makeService(db, makeQuestion(), makeReport());
    const { snapshot } = await service.build(makeUser(), 'item-1', {
      assessmentId: 'as-1',
    });
    expect(snapshot.dominantDistractor).toBe('D'); // 11 > 4 > 3, clave B excluida
  });

  it('calcula punto-biserial desde la matriz de respuestas', async () => {
    const db = dbNoSection();
    const { service } = makeService(db, makeQuestion(), makeReport());
    const { snapshot } = await service.build(makeUser(), 'item-1', {
      assessmentId: 'as-1',
    });
    expect(snapshot.pointBiserial).not.toBeNull();
    expect(typeof snapshot.pointBiserial).toBe('number');
  });

  it('incluye el pasaje cuando la sección tiene passageText', async () => {
    // Secuencia con sección: items(meta) → instrumentSections(passage) →
    // sectionAttachments → items(instrumento) → responses
    const db = makeDb([
      [{ instrumentId: 'inst-1', sectionId: 'sec-1', content: {} }],
      [
        {
          passageTitle: 'El zorro',
          passageText: 'Había una vez...',
          passageFormat: 'narrative',
        },
      ],
      [], // sin adjuntos
      [{ itemId: 'item-1' }, { itemId: 'item-2' }],
      [
        { studentId: 's1', itemId: 'item-1', isCorrect: true },
        { studentId: 's1', itemId: 'item-2', isCorrect: false },
      ],
    ]);
    const { service } = makeService(db, makeQuestion(), makeReport());
    const { snapshot } = await service.build(makeUser(), 'item-1', {
      assessmentId: 'as-1',
    });
    expect(snapshot.passage).toEqual({
      title: 'El zorro',
      text: 'Había una vez...',
      format: 'narrative',
    });
  });

  it('omite imágenes con solo storageKey S3 (sin url http fetcheable)', async () => {
    const db = makeDb([
      [{ instrumentId: 'inst-1', sectionId: 'sec-1', content: {} }],
      [{ passageTitle: null, passageText: null, passageFormat: null }],
      [
        {
          url: null,
          mimeType: 'image/png',
          note: 'mapa',
          kind: 'image',
        },
      ],
      [{ itemId: 'item-1' }, { itemId: 'item-2' }],
      [{ studentId: 's1', itemId: 'item-1', isCorrect: true }],
    ]);
    const { service } = makeService(db, makeQuestion(), makeReport());
    const { snapshot, images } = await service.build(makeUser(), 'item-1', {
      assessmentId: 'as-1',
    });
    expect(snapshot.images).toEqual([]);
    expect(images).toEqual([]);
  });

  it('fetchea imagen del ítem (url http) a base64 best-effort', async () => {
    const fakeBytes = new Uint8Array([1, 2, 3, 4]);
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({
        ok: true,
        headers: { get: (h: string) => (h === 'content-type' ? 'image/png' : null) },
        arrayBuffer: async () => fakeBytes.buffer,
      } as unknown as Response);

    const db = dbNoSection();
    const { service } = makeService(
      db,
      makeQuestion({ imageUrl: 'https://cdn.example.cl/q.png' }),
      makeReport(),
    );
    const { snapshot, images } = await service.build(makeUser(), 'item-1', {
      assessmentId: 'as-1',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(snapshot.images).toHaveLength(1);
    expect(snapshot.images[0]).toMatchObject({
      url: 'https://cdn.example.cl/q.png',
      mimeType: 'image/png',
      source: 'item',
    });
    expect(images).toHaveLength(1);
    expect(images[0]).toEqual({
      mimeType: 'image/png',
      data: Buffer.from(fakeBytes).toString('base64'),
    });
    fetchSpy.mockRestore();
  });

  it('fetch fallido → omite la imagen (degrada a texto), sin lanzar', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network down'));
    const db = dbNoSection();
    const { service } = makeService(
      db,
      makeQuestion({ imageUrl: 'https://cdn.example.cl/q.png' }),
      makeReport(),
    );
    const { snapshot, images } = await service.build(makeUser(), 'item-1', {
      assessmentId: 'as-1',
    });
    expect(snapshot.images).toEqual([]);
    expect(images).toEqual([]);
    fetchSpy.mockRestore();
  });

  it('no contiene PII: el snapshot solo lleva contenido del ítem + agregados', async () => {
    const db = dbNoSection();
    const { service } = makeService(db, makeQuestion(), makeReport());
    const { snapshot } = await service.build(makeUser(), 'item-1', {
      assessmentId: 'as-1',
    });
    const serialized = JSON.stringify(snapshot);
    // claves típicas de PII de alumno no deben aparecer
    expect(serialized).not.toContain('studentId');
    expect(serialized).not.toContain('rut');
    expect(serialized).not.toContain('fullName');
    expect(serialized).not.toContain('firstName');
  });

  it('toma el orgId del token (multi-tenancy); sin org activa lanza', async () => {
    const db = dbNoSection();
    const { service } = makeService(db, makeQuestion(), makeReport());
    await expect(
      service.build(makeUser({ orgId: null }), 'item-1', { assessmentId: 'as-1' }),
    ).rejects.toThrow('organización');
  });
});
