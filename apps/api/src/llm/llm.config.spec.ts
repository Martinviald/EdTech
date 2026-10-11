import { LLM_FEATURE_DEFAULTS } from '@soe/types';
import { reportServerError } from '../common/observability/report-error';
import { LlmModelUnavailableError } from './llm.errors';
import { LlmConfigService } from './llm.config';
import type { LlmModelsService } from './llm-models.service';
import type { Database } from '../database/database.types';

interface CatalogEntry {
  maxOutputTokens: number;
  supportsSamplingParams: boolean;
  enabled: boolean;
  deprecatedAt: string | null;
}

function entry(
  maxOutputTokens: number,
  overrides: Partial<Omit<CatalogEntry, 'maxOutputTokens'>> = {},
): CatalogEntry {
  return {
    maxOutputTokens,
    supportsSamplingParams: true,
    enabled: true,
    deprecatedAt: null,
    ...overrides,
  };
}

const CATALOG = new Map<string, CatalogEntry>([
  ['anthropic:claude-sonnet-4-6', entry(16384)],
  ['anthropic:claude-haiku-5-5', entry(8192, { supportsSamplingParams: false })],
  ['anthropic:claude-apagado', entry(8192, { enabled: false })],
  ['anthropic:claude-retirado', entry(8192, { deprecatedAt: '2026-09-01T00:00:00.000Z' })],
  ['gemini:gemini-2.5-pro', entry(32768)],
  ['gemini:gemini-2.5-flash', entry(8192)],
  ['openai:gpt-5.4-mini', entry(16384, { supportsSamplingParams: false })],
]);

const models = {
  findModel: (provider: string, model: string) =>
    Promise.resolve(CATALOG.get(`${provider}:${model}`)),
} as unknown as LlmModelsService;

jest.mock('../common/observability/report-error', () => ({ reportServerError: jest.fn() }));

function makeService(db: Database): LlmConfigService {
  return new LlmConfigService(db, models);
}

function makeDb(rows: Array<{ provider: string; model: string; orgId: string | null }>): Database {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return { select: () => chain } as unknown as Database;
}

describe('LlmConfigService.resolve', () => {
  it('usa la fila de llm_settings cuando existe (proveedor + modelo)', async () => {
    const db = makeDb([{ provider: 'anthropic', model: 'claude-sonnet-4-6', orgId: null }]);
    const cfg = await makeService(db).resolve(null, 'assessment_analysis');

    expect(cfg.provider).toBe('anthropic');
    expect(cfg.model).toBe('claude-sonnet-4-6');
    expect(cfg.maxTokens).toBe(16384);
    expect(cfg.temperature).toBe(0);
  });

  it('omite la temperatura cuando el modelo del catálogo no acepta parámetros de muestreo', async () => {
    const db = makeDb([{ provider: 'anthropic', model: 'claude-haiku-5-5', orgId: null }]);
    const cfg = await makeService(db).resolve(null, 'answer_transcription');

    expect(cfg.model).toBe('claude-haiku-5-5');
    expect(cfg).not.toHaveProperty('temperature');
  });

  it('envía la temperatura por defecto si el modelo no está en el catálogo', async () => {
    const cfg = await makeService(makeDb([])).forChoice({
      provider: 'anthropic',
      model: 'claude-sin-catalogo',
    });

    expect(cfg.temperature).toBe(0);
  });

  it('conserva temperatura 0 para Gemini', async () => {
    const cfg = await makeService(makeDb([])).resolve(null, 'remedial');

    expect(cfg.provider).toBe('gemini');
    expect(cfg.temperature).toBe(0);
  });

  it('cae al default de código cuando no hay fila', async () => {
    const cfg = await makeService(makeDb([])).resolve(null, 'remedial');

    expect(cfg.provider).toBe(LLM_FEATURE_DEFAULTS.remedial.provider);
    expect(cfg.model).toBe(LLM_FEATURE_DEFAULTS.remedial.model);
    expect(cfg.maxTokens).toBeGreaterThan(0);
  });

  it('deriva el budget del modelo (análisis Pro → 32768)', async () => {
    const cfg = await makeService(makeDb([])).resolve(null, 'assessment_analysis');

    expect(cfg.model).toBe('gemini-2.5-pro');
    expect(cfg.maxTokens).toBe(32768);
  });

  it('forChoice deriva el budget del catálogo para un modelo fijado por la ruta', async () => {
    const cfg = await makeService(makeDb([])).forChoice({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    });

    expect(cfg).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      maxTokens: 16384,
      temperature: 0,
    });
  });

  it('usa el tope de respaldo cuando el modelo no está en el catálogo', async () => {
    const cfg = await makeService(makeDb([])).forChoice({
      provider: 'gemini',
      model: 'gemini-desconocido',
    });

    expect(cfg.maxTokens).toBe(4096);
  });
});

describe('LlmConfigService con modelos deshabilitados o deprecados', () => {
  beforeEach(() => {
    jest.mocked(reportServerError).mockClear();
  });

  it.each(['claude-apagado', 'claude-retirado'])(
    'usa el default de la funcionalidad si el modelo configurado es %s',
    async (model) => {
      const service = makeService(makeDb([{ provider: 'anthropic', model, orgId: null }]));

      const cfg = await service.resolve(null, 'remedial');
      await service.resolve(null, 'remedial');

      expect(cfg.provider).toBe(LLM_FEATURE_DEFAULTS.remedial.provider);
      expect(cfg.model).toBe(LLM_FEATURE_DEFAULTS.remedial.model);
      expect(reportServerError).toHaveBeenCalledTimes(1);
    },
  );

  it('forTarget lanza un error claro si el modelo no está en el catálogo', async () => {
    await expect(
      makeService(makeDb([])).forTarget({ provider: 'anthropic', model: 'claude-inexistente' }),
    ).rejects.toBeInstanceOf(LlmModelUnavailableError);
  });

  it('forTarget lanza un error claro si el modelo está deshabilitado', async () => {
    await expect(
      makeService(makeDb([])).forTarget({ provider: 'anthropic', model: 'claude-apagado' }),
    ).rejects.toThrow('claude-apagado');
  });

  it('forTarget resuelve un modelo habilitado del catálogo', async () => {
    const cfg = await makeService(makeDb([])).forTarget({
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
    });

    expect(cfg).toEqual({ provider: 'anthropic', model: 'claude-haiku-5-5', maxTokens: 8192 });
  });
});
