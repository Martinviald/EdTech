import {
  DEFAULT_CONSENSUS_POLICY,
  type ReaderSpec,
  type ReadingContext,
  type ReadingRoute,
} from '@soe/types';
import { applyOrgRestrictions, isProviderAllowedByOrg, resolveReadingRoute } from './resolve-route';

const ORG = '00000000-0000-4000-8000-000000000001';
const OTHER_ORG = '00000000-0000-4000-8000-000000000002';
const ITEM = '00000000-0000-4000-8000-0000000000a1';
const INSTRUMENT = '00000000-0000-4000-8000-0000000000b1';
const SUBJECT = '00000000-0000-4000-8000-0000000000c1';
const GRADE = '00000000-0000-4000-8000-0000000000d1';

function reader(key: string, provider: ReaderSpec['provider'], family: string): ReaderSpec {
  return {
    key,
    transcriberId: 'llm',
    provider,
    family,
    model: `${key}-model`,
    promptRef: 'transcribe.short-answer@2',
    hints: 'none',
    params: { maxOutputTokens: 400, reasoning: 'off', timeoutMs: 20000 },
  };
}

const HAIKU = reader('haiku', 'anthropic', 'claude');
const FLASH = reader('flash', 'gemini', 'gemini');
const GPT = reader('gpt', 'openai', 'gpt');

let sequence = 0;
function route(overrides: Partial<ReadingRoute>): ReadingRoute {
  sequence += 1;
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    version: 1,
    orgId: null,
    status: 'active',
    level: 'default',
    itemId: null,
    instrumentId: null,
    formatKind: null,
    subjectId: null,
    gradeId: null,
    readers: [HAIKU, FLASH],
    fallbackReaders: [],
    shadowReaders: [],
    shadowSampleRate: 0,
    policy: DEFAULT_CONSENSUS_POLICY,
    ...overrides,
  };
}

const CONTEXT: ReadingContext = {
  orgId: ORG,
  itemId: ITEM,
  instrumentId: INSTRUMENT,
  subjectId: SUBJECT,
  gradeId: GRADE,
  responseFormat: { kind: 'integer', maxChars: 4, allowNegative: false },
};

describe('resolveReadingRoute', () => {
  const byLevel = {
    default: route({ level: 'default' }),
    format: route({ level: 'format', formatKind: 'integer' }),
    formatSubject: route({ level: 'format_subject', formatKind: 'integer', subjectId: SUBJECT }),
    formatSubjectGrade: route({
      level: 'format_subject_grade',
      formatKind: 'integer',
      subjectId: SUBJECT,
      gradeId: GRADE,
    }),
    instrument: route({ level: 'instrument', instrumentId: INSTRUMENT }),
    item: route({ level: 'item', itemId: ITEM }),
  };
  const all = Object.values(byLevel);

  it('la más específica gana: item > instrument > formato+asignatura+curso > … > default', () => {
    const order = [
      byLevel.item,
      byLevel.instrument,
      byLevel.formatSubjectGrade,
      byLevel.formatSubject,
      byLevel.format,
      byLevel.default,
    ];
    order.forEach((expected, index) => {
      const remaining = order.slice(index);
      expect(resolveReadingRoute(CONTEXT, remaining)?.routeId).toBe(expected.id);
    });
    expect(resolveReadingRoute(CONTEXT, all)?.matchedLevel).toBe('item');
  });

  it('en el mismo nivel la org gana a la global; la de otra org no aplica', () => {
    const global = route({ level: 'format', formatKind: 'integer' });
    const mine = route({ level: 'format', formatKind: 'integer', orgId: ORG });
    const foreign = route({ level: 'item', itemId: ITEM, orgId: OTHER_ORG });
    expect(resolveReadingRoute(CONTEXT, [global, mine, foreign])?.routeId).toBe(mine.id);
  });

  it('solo rutas activas', () => {
    const shadow = route({ level: 'item', itemId: ITEM, status: 'shadow' });
    const retired = route({ level: 'instrument', instrumentId: INSTRUMENT, status: 'retired' });
    expect(resolveReadingRoute(CONTEXT, [shadow, retired, byLevel.default])?.routeId).toBe(
      byLevel.default.id,
    );
  });

  it('no calza formato distinto, ni asignatura nula', () => {
    const fraction = route({ level: 'format', formatKind: 'fraction' });
    const noSubject = { ...CONTEXT, subjectId: null };
    expect(resolveReadingRoute(CONTEXT, [fraction])).toBeNull();
    expect(resolveReadingRoute(noSubject, [byLevel.formatSubject])).toBeNull();
  });

  it('a igual nivel y alcance gana la versión más alta', () => {
    const v1 = route({ level: 'format', formatKind: 'integer', version: 1 });
    const v2 = route({ level: 'format', formatKind: 'integer', version: 2 });
    expect(resolveReadingRoute(CONTEXT, [v1, v2])?.routeVersion).toBe(2);
  });

  it('devuelve lectores, sombra, política y respaldo', () => {
    const full = route({
      level: 'item',
      itemId: ITEM,
      shadowReaders: [GPT],
      fallbackReaders: [GPT],
    });
    expect(resolveReadingRoute(CONTEXT, [full])).toEqual({
      routeId: full.id,
      routeVersion: 1,
      matchedLevel: 'item',
      readers: [HAIKU, FLASH],
      shadowReaders: [GPT],
      policy: DEFAULT_CONSENSUS_POLICY,
      fallbackReaders: [GPT],
    });
  });
});

describe('applyOrgRestrictions', () => {
  const resolved = resolveReadingRoute(CONTEXT, [
    route({ level: 'default', fallbackReaders: [GPT], shadowReaders: [GPT] }),
  ]);
  if (!resolved) throw new Error('sin ruta');

  it('sin restricciones deja la ruta igual', () => {
    const { route: restricted, notReadReason } = applyOrgRestrictions(resolved, {});
    expect(restricted.readers).toEqual([HAIKU, FLASH]);
    expect(notReadReason).toBeNull();
  });

  it('allowExternalVision: false → sin lectores', () => {
    expect(applyOrgRestrictions(resolved, { allowExternalVision: false })).toMatchObject({
      route: { readers: [], shadowReaders: [] },
      notReadReason: 'external_vision_disabled',
    });
  });

  it('un proveedor no permitido se reemplaza por el respaldo', () => {
    const { route: restricted, notReadReason } = applyOrgRestrictions(resolved, {
      allowedProviders: ['anthropic', 'openai'],
    });
    expect(restricted.readers).toEqual([HAIKU, GPT]);
    expect(restricted.shadowReaders).toEqual([GPT]);
    expect(notReadReason).toBeNull();
  });

  it('si ni el respaldo alcanza → insufficient_readers (nunca se inventa un lector)', () => {
    expect(applyOrgRestrictions(resolved, { allowedProviders: ['anthropic'] })).toMatchObject({
      route: { readers: [] },
      notReadReason: 'insufficient_readers',
    });
  });

  it('reviewAll endurece la política', () => {
    expect(applyOrgRestrictions(resolved, { reviewAll: true }).route.policy.autoAccept).toBe(false);
  });
});

describe('revisión F2 — rutas', () => {
  it('hallazgo 12: una ruta de ítem o instrumento con formato exige el mismo formato', () => {
    const decimalItem = route({ level: 'item', itemId: ITEM, formatKind: 'decimal' });
    const decimalInstrument = route({
      level: 'instrument',
      instrumentId: INSTRUMENT,
      formatKind: 'decimal',
    });
    const fallback = route({ level: 'format', formatKind: 'integer' });
    expect(resolveReadingRoute(CONTEXT, [decimalItem, decimalInstrument, fallback])?.routeId).toBe(
      fallback.id,
    );
    const integerItem = route({ level: 'item', itemId: ITEM, formatKind: 'integer' });
    expect(resolveReadingRoute(CONTEXT, [integerItem, fallback])?.routeId).toBe(integerItem.id);
  });

  describe('hallazgo 3: el lector de desempate respeta las restricciones de la org', () => {
    const policy = {
      ...DEFAULT_CONSENSUS_POLICY,
      onDisagreement: 'tiebreak_reader' as const,
      tiebreakReader: GPT,
    };
    const resolved = resolveReadingRoute(CONTEXT, [route({ level: 'default', policy })]);
    if (!resolved) throw new Error('sin ruta');

    it('proveedor no permitido → sin desempate, desacuerdo a revisión', () => {
      expect(
        applyOrgRestrictions(resolved, { allowedProviders: ['anthropic', 'gemini'] }).route.policy,
      ).toMatchObject({ tiebreakReader: null, onDisagreement: 'review' });
    });

    it('sin visión externa → sin desempate', () => {
      expect(
        applyOrgRestrictions(resolved, { allowExternalVision: false }).route.policy,
      ).toMatchObject({ tiebreakReader: null, onDisagreement: 'review' });
    });

    it('proveedor permitido → el desempate se conserva', () => {
      expect(
        applyOrgRestrictions(resolved, { allowedProviders: ['anthropic', 'gemini', 'openai'] })
          .route.policy,
      ).toMatchObject({ tiebreakReader: GPT, onDisagreement: 'tiebreak_reader' });
    });
  });
});

describe('isProviderAllowedByOrg', () => {
  it('sin lista de proveedores permite cualquiera mientras la visión externa esté permitida', () => {
    expect(isProviderAllowedByOrg({}, 'gemini')).toBe(true);
    expect(isProviderAllowedByOrg({ allowExternalVision: false }, 'gemini')).toBe(false);
  });

  it('con lista de proveedores solo permite los de la lista', () => {
    expect(isProviderAllowedByOrg({ allowedProviders: ['anthropic'] }, 'anthropic')).toBe(true);
    expect(isProviderAllowedByOrg({ allowedProviders: ['anthropic'] }, 'gemini')).toBe(false);
  });
});
