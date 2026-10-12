jest.mock('drizzle-orm', () => ({
  ...jest.requireActual('drizzle-orm'),
  ...jest.requireActual('./testing/drizzle-predicates').DRIZZLE_PREDICATES,
}));

import { readingRoutes } from '@soe/db';
import {
  DEFAULT_CONSENSUS_POLICY,
  DEFAULT_ORG_ANSWER_READING_SETTINGS,
  type ReaderSpec,
  type ReadingContext,
} from '@soe/types';
import * as observability from '../common/observability/report-error';
import { ReadingRoutesService } from './reading-routes.service';
import { InMemoryDatabase } from './testing/in-memory-database';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const GLOBAL_ROUTE = '33333333-3333-4333-8333-333333333333';
const ORG_ROUTE = '44444444-4444-4444-8444-444444444444';
const FOREIGN_ROUTE = '55555555-5555-4555-8555-555555555555';
const BROKEN_ROUTE = '66666666-6666-4666-8666-666666666666';

function reader(key: string, provider: ReaderSpec['provider'], family: string): ReaderSpec {
  return {
    key,
    transcriberId: 'llm',
    provider,
    family,
    model: key,
    promptRef: 'transcribe.short-answer@2',
    hints: 'none',
    params: { maxOutputTokens: 2048, reasoning: 'off', timeoutMs: 30000 },
  };
}

const HAIKU = reader('haiku', 'anthropic', 'anthropic-haiku');
const FLASH = reader('flash', 'gemini', 'gemini-flash-lite');
const LUNA = reader('luna', 'openai', 'openai-luna');

const CONTEXT: ReadingContext = {
  orgId: ORG_ID,
  itemId: '77777777-7777-4777-8777-777777777777',
  instrumentId: '88888888-8888-4888-8888-888888888888',
  subjectId: null,
  gradeId: null,
  responseFormat: { kind: 'integer', maxChars: 4, allowNegative: false },
};

function route(id: string, orgId: string | null, overrides: Record<string, unknown> = {}) {
  return {
    id,
    orgId,
    status: 'active',
    level: 'default',
    readers: [HAIKU, FLASH],
    fallbackReaders: [LUNA],
    shadowReaders: [],
    shadowSampleRate: '0.250',
    policy: DEFAULT_CONSENSUS_POLICY,
    version: 1,
    ...overrides,
  };
}

function makeService(rows: Array<Record<string, unknown>>) {
  const memory = new InMemoryDatabase();
  memory.seed(readingRoutes, rows);
  return new ReadingRoutesService(memory.asDatabase());
}

afterEach(() => jest.restoreAllMocks());

describe('ReadingRoutesService', () => {
  it('carga rutas globales y de la org, nunca las de otra org, e ignora las inválidas reportándolas', async () => {
    const report = jest
      .spyOn(observability, 'reportServerError')
      .mockImplementation(() => undefined);
    const service = makeService([
      route(GLOBAL_ROUTE, null),
      route(ORG_ROUTE, ORG_ID),
      route(FOREIGN_ROUTE, OTHER_ORG),
      route(BROKEN_ROUTE, null, { readers: [] }),
      route('99999999-9999-4999-8999-999999999999', null, { status: 'retired' }),
    ]);

    const catalog = await service.loadCatalog(ORG_ID);

    expect(catalog.routes.map((entry) => entry.id).sort()).toEqual(
      [GLOBAL_ROUTE, ORG_ROUTE].sort(),
    );
    expect(catalog.shadowSampleRateById.get(ORG_ROUTE)).toBe(0.25);
    expect(report).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ routeId: BROKEN_ROUTE }),
    );
  });

  it('en el mismo nivel la ruta de la org gana a la global', async () => {
    const service = makeService([route(GLOBAL_ROUTE, null), route(ORG_ROUTE, ORG_ID)]);
    const catalog = await service.loadCatalog(ORG_ID);

    const resolved = service.resolve(CONTEXT, catalog, DEFAULT_ORG_ANSWER_READING_SETTINGS);

    expect(resolved).toMatchObject({
      route: { routeId: ORG_ROUTE },
      notReadReason: null,
      shadowSampleRate: 0.25,
    });
  });

  it('un proveedor no permitido por la org se reemplaza por un lector de respaldo', async () => {
    const service = makeService([route(GLOBAL_ROUTE, null)]);
    const catalog = await service.loadCatalog(ORG_ID);

    const resolved = service.resolve(CONTEXT, catalog, {
      ...DEFAULT_ORG_ANSWER_READING_SETTINGS,
      allowedProviders: ['anthropic', 'openai'],
    });

    expect(resolved?.route.readers.map((entry) => entry.key)).toEqual(['haiku', 'luna']);
    expect(resolved?.notReadReason).toBeNull();
  });

  it('sin rutas aplicables devuelve null', async () => {
    const service = makeService([]);
    const catalog = await service.loadCatalog(ORG_ID);

    expect(service.resolve(CONTEXT, catalog, DEFAULT_ORG_ANSWER_READING_SETTINGS)).toBeNull();
  });
});
