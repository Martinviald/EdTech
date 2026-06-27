import { BadRequestException } from '@nestjs/common';
import { LLM_FEATURES } from '@soe/types';
import { LlmSettingsService } from './llm-settings.service';
import type { Database } from '../database/database.types';

interface GlobalRow {
  feature: string;
  provider: string;
  model: string;
}

function makeDb(selectRows: GlobalRow[]) {
  const insert = jest.fn(() => ({ values: jest.fn(() => Promise.resolve()) }));
  const update = jest.fn(() => ({
    set: jest.fn(() => ({ where: jest.fn(() => Promise.resolve()) })),
  }));
  // Cadena thenable: soporta `await select().from().where()` y `...where().limit()`.
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(selectRows),
    then: (res: (v: GlobalRow[]) => unknown) => Promise.resolve(selectRows).then(res),
  };
  const select = jest.fn(() => chain);
  const db = { select, insert, update } as unknown as Database;
  return { db, insert, update };
}

describe('LlmSettingsService', () => {
  describe('getSettings', () => {
    it('devuelve las 5 funcionalidades con default cuando no hay filas', async () => {
      const { db } = makeDb([]);
      const res = await new LlmSettingsService(db).getSettings();

      expect(res.features).toHaveLength(LLM_FEATURES.length);
      expect(res.features.every((f) => f.source === 'default')).toBe(true);
      expect(res.providers.map((p) => p.id).sort()).toEqual(['anthropic', 'gemini']);
      expect(res.catalog.gemini?.length).toBeGreaterThan(0);
    });

    it('marca como "global" la funcionalidad con fila persistida', async () => {
      const { db } = makeDb([
        { feature: 'remedial', provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      ]);
      const res = await new LlmSettingsService(db).getSettings();

      const remedial = res.features.find((f) => f.feature === 'remedial');
      expect(remedial?.source).toBe('global');
      expect(remedial?.provider).toBe('anthropic');
      expect(remedial?.model).toBe('claude-haiku-4-5-20251001');
    });
  });

  describe('upsertGlobal', () => {
    it('inserta la fila global cuando no existía', async () => {
      const { db, insert, update } = makeDb([]);
      await new LlmSettingsService(db).upsertGlobal('remedial', {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
      });

      expect(insert).toHaveBeenCalledTimes(1);
      expect(update).not.toHaveBeenCalled();
    });

    it('rechaza un modelo que no pertenece al catálogo del proveedor', async () => {
      const { db } = makeDb([]);
      await expect(
        new LlmSettingsService(db).upsertGlobal('remedial', {
          provider: 'gemini',
          model: 'modelo-inexistente',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
