import { LLM_FEATURE_DEFAULTS } from '@soe/types';
import { LlmConfigService } from './llm.config';
import type { Database } from '../database/database.types';

/** Mock de la cadena Drizzle: `select().from().where().orderBy().limit()` → `rows`. */
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
    const cfg = await new LlmConfigService(db).resolve(null, 'assessment_analysis');

    expect(cfg.provider).toBe('anthropic');
    expect(cfg.model).toBe('claude-sonnet-4-6');
    expect(cfg.maxTokens).toBe(16384); // derivado del catálogo
    expect(cfg.temperature).toBe(0);
  });

  it('cae al default de código cuando no hay fila', async () => {
    const cfg = await new LlmConfigService(makeDb([])).resolve(null, 'remedial');

    expect(cfg.provider).toBe(LLM_FEATURE_DEFAULTS.remedial.provider);
    expect(cfg.model).toBe(LLM_FEATURE_DEFAULTS.remedial.model);
    expect(cfg.maxTokens).toBeGreaterThan(0);
  });

  it('deriva el budget del modelo (análisis Pro → 32768)', async () => {
    const cfg = await new LlmConfigService(makeDb([])).resolve(null, 'assessment_analysis');

    expect(cfg.model).toBe('gemini-2.5-pro');
    expect(cfg.maxTokens).toBe(32768);
  });
});
