import type { Database } from '@soe/db';
import { RemedialBriefService, type RemedialBriefInput } from './remedial-brief.service';

// ──────────────────────────────────────────────────────────────────────────────
// Mock DB: las lecturas corren dentro de withOrgContext → db.transaction(cb), que
// el mock reentra con el mismo db. La query es .select().from().where().limit(1).
// No requiere DATABASE_URL real.
// ──────────────────────────────────────────────────────────────────────────────

type AnalysisRow = { input: unknown; output: unknown } | undefined;

function makeDb(row: AnalysisRow): Database {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(row ? [row] : []),
  };
  const db = {
    select: () => chain,
    execute: async () => [],
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
  } as unknown as Database;
  return db;
}

/** Output válido de `assessment_insights` con una brecha sobre `nodeId`. */
function makeOutput(nodeId = 'node-1'): Record<string, unknown> {
  return {
    headline: 'Titular',
    executiveSummary: { director: 'd', teacher: 't' },
    topItems: [],
    bottomItems: [],
    skillGaps: [
      {
        nodeId,
        nodeName: 'Fracciones equivalentes',
        achievement: 42,
        rootCauseHypothesis: 'No dominan la equivalencia entre fracciones',
        misconceptionSignal: 'Comparan numeradores sin igualar denominadores',
        reteachStrategy: 'Representaciones visuales de fracciones',
        exampleActivity: 'Tiras de fracciones',
        remedialGroupSize: 8,
      },
    ],
    recommendations: [],
    reliability: { kr20: 0.81, interpretation: 'buena' },
    confidence: 0.7,
    caveats: [],
  };
}

/** Snapshot determinista (input) con un ítem del nodo objetivo y otro ajeno. */
function makeSnapshot(nodeId = 'node-1'): Record<string, unknown> {
  return {
    assessmentId: 'assess-1',
    instrumentName: null,
    gradeName: null,
    subjectName: null,
    evaluated: 20,
    enrolled: 25,
    reliability: { kr20: 0.81 },
    items: [
      {
        position: 3,
        skillName: 'Fracciones',
        nodeId,
        difficulty: 0.4,
        discrimination: 0.3,
        pointBiserial: 0.25,
        correctLabel: 'B',
        dominantDistractor: 'C',
        distribution: { A: 2, B: 8, C: 9, D: 1 },
        stem: '¿Cuál fracción es equivalente a 1/2?',
      },
      {
        position: 5,
        skillName: 'Otra habilidad',
        nodeId: 'node-other',
        difficulty: 0.6,
        discrimination: 0.2,
        pointBiserial: 0.1,
        correctLabel: 'A',
        dominantDistractor: 'D',
        distribution: { A: 12, D: 8 },
        stem: 'Ítem de otra habilidad',
      },
    ],
    skills: [],
  };
}

const baseInput: RemedialBriefInput = {
  orgId: 'org-1',
  nodeId: 'node-1',
  sourceAnalysisId: 'analysis-1',
};

describe('RemedialBriefService', () => {
  it('happy path: destila causa raíz + realErrors del nodo (evidencia del error)', async () => {
    const db = makeDb({ output: makeOutput(), input: makeSnapshot() });
    const service = new RemedialBriefService(db);

    const brief = await service.build(baseInput);

    expect(brief).not.toBeNull();
    expect(brief?.rootCauseHypothesis).toBe('No dominan la equivalencia entre fracciones');
    expect(brief?.misconceptionSignal).toBe('Comparan numeradores sin igualar denominadores');
    expect(brief?.reteachStrategy).toBe('Representaciones visuales de fracciones');
    expect(brief?.achievement).toBe(42);
    // realErrors se filtra al nodo objetivo (el ítem ajeno queda fuera).
    expect(brief?.realErrors).toHaveLength(1);
    expect(brief?.realErrors[0]).toEqual({
      stem: '¿Cuál fracción es equivalente a 1/2?',
      correctLabel: 'B',
      dominantDistractor: 'C',
      distribution: { A: 2, B: 8, C: 9, D: 1 },
    });
  });

  it('sin sourceAnalysisId → null (generación solo curricular)', async () => {
    const db = makeDb({ output: makeOutput(), input: makeSnapshot() });
    const service = new RemedialBriefService(db);

    const brief = await service.build({ orgId: 'org-1', nodeId: 'node-1' });

    expect(brief).toBeNull();
  });

  it('fila inexistente → null', async () => {
    const service = new RemedialBriefService(makeDb(undefined));
    expect(await service.build(baseInput)).toBeNull();
  });

  it('output no parseable → null', async () => {
    const db = makeDb({ output: { garbage: true }, input: makeSnapshot() });
    const service = new RemedialBriefService(db);
    expect(await service.build(baseInput)).toBeNull();
  });

  it('input (snapshot) no parseable → null', async () => {
    const db = makeDb({ output: makeOutput(), input: { not: 'a snapshot' } });
    const service = new RemedialBriefService(db);
    expect(await service.build(baseInput)).toBeNull();
  });

  it('nodo ausente en skillGaps → null', async () => {
    // El output solo tiene una brecha sobre 'node-x'; pedimos 'node-1'.
    const db = makeDb({ output: makeOutput('node-x'), input: makeSnapshot() });
    const service = new RemedialBriefService(db);
    expect(await service.build(baseInput)).toBeNull();
  });

  it('nodo presente pero sin ítems propios en el snapshot → brief con realErrors vacío', async () => {
    // skillGap sobre node-1, pero el snapshot no tiene ítems de node-1.
    const db = makeDb({ output: makeOutput('node-1'), input: makeSnapshot('node-solo-otro') });
    const service = new RemedialBriefService(db);

    const brief = await service.build(baseInput);
    expect(brief).not.toBeNull();
    expect(brief?.realErrors).toHaveLength(0);
    expect(brief?.rootCauseHypothesis).toBe('No dominan la equivalencia entre fracciones');
  });
});
