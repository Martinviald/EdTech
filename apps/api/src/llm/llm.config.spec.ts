import { LLM_FEATURE_DEFAULTS } from '@soe/types';
import { LlmConfigService } from './llm.config';
import type { LlmModelsService } from './llm-models.service';
import type { Database } from '../database/database.types';

const CATALOG_MAX_TOKENS = new Map([
  ['anthropic:claude-sonnet-4-6', 16384],
  ['gemini:gemini-2.5-pro', 32768],
  ['gemini:gemini-2.5-flash', 8192],
]);

const models = {
  resolveMaxTokens: (provider: string, model: string) =>
    Promise.resolve(CATALOG_MAX_TOKENS.get(`${provider}:${model}`) ?? 4096),
} as unknown as LlmModelsService;

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
    expect(cfg).not.toHaveProperty('temperature');
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

    expect(cfg).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6', maxTokens: 16384 });
  });

  it('usa el tope de respaldo cuando el modelo no está en el catálogo', async () => {
    const cfg = await makeService(makeDb([])).forChoice({
      provider: 'gemini',
      model: 'gemini-desconocido',
    });

    expect(cfg.maxTokens).toBe(4096);
  });
});
