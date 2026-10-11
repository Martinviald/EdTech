import { BadRequestException } from '@nestjs/common';
import { LLM_FEATURES } from '@soe/types';
import { LlmSettingsService } from './llm-settings.service';
import type { LlmModelsService } from './llm-models.service';
import type { Database } from '../database/database.types';
import type { LlmProvider } from './llm.types';

interface FakeCatalogModel {
  provider: string;
  modelId: string;
  supportsImages: boolean;
}

const SELECTABLE_MODELS: FakeCatalogModel[] = [
  { provider: 'gemini', modelId: 'gemini-2.5-flash', supportsImages: true },
  { provider: 'anthropic', modelId: 'claude-haiku-4-5-20251001', supportsImages: true },
  { provider: 'gemini', modelId: 'gemini-texto', supportsImages: false },
];

function makeModels(): LlmModelsService {
  return {
    listEnabledByProvider: () =>
      Promise.resolve({
        gemini: [
          { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', maxTokens: 8192, multimodal: true },
        ],
        anthropic: [],
        openai: [],
      }),
    findSelectableModel: (provider: string, modelId: string) =>
      Promise.resolve(
        SELECTABLE_MODELS.find((m) => m.provider === provider && m.modelId === modelId),
      ),
  } as unknown as LlmModelsService;
}

function makeRegistry(): LlmProvider[] {
  return [
    { name: 'gemini', isAvailable: () => true },
    { name: 'anthropic', isAvailable: () => true },
    { name: 'openai', isAvailable: () => false },
  ] as unknown as LlmProvider[];
}

function makeService(db: Database): LlmSettingsService {
  return new LlmSettingsService(db, makeModels(), makeRegistry());
}

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
    it('devuelve todas las funcionalidades con default cuando no hay filas', async () => {
      const { db } = makeDb([]);
      const res = await makeService(db).getSettings();

      expect(res.features).toHaveLength(LLM_FEATURES.length);
      expect(res.features.every((f) => f.source === 'default')).toBe(true);
      expect(res.providers.map((p) => p.id).sort()).toEqual(['anthropic', 'gemini', 'openai']);
      expect(res.catalog.gemini?.map((m) => m.id)).toEqual(['gemini-2.5-flash']);
      expect(res.catalog.anthropic).toEqual([]);
    });

    it('marca como no disponible al proveedor sin API key configurada', async () => {
      const { db } = makeDb([]);
      const res = await makeService(db).getSettings();

      expect(res.providers).toEqual([
        { id: 'gemini', label: 'Google Gemini', available: true },
        { id: 'anthropic', label: 'Anthropic Claude', available: true },
        { id: 'openai', label: 'OpenAI', available: false },
      ]);
    });

    it('ninguna funcionalidad usa OpenAI por defecto', async () => {
      const { db } = makeDb([]);
      const res = await makeService(db).getSettings();

      expect(res.features.some((f) => f.provider === 'openai')).toBe(false);
    });

    it('marca como "global" la funcionalidad con fila persistida', async () => {
      const { db } = makeDb([
        { feature: 'remedial', provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      ]);
      const res = await makeService(db).getSettings();

      const remedial = res.features.find((f) => f.feature === 'remedial');
      expect(remedial?.source).toBe('global');
      expect(remedial?.provider).toBe('anthropic');
      expect(remedial?.model).toBe('claude-haiku-4-5-20251001');
    });
  });

  describe('upsertGlobal', () => {
    it('inserta la fila global cuando no existía', async () => {
      const { db, insert, update } = makeDb([]);
      await makeService(db).upsertGlobal('remedial', {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
      });

      expect(insert).toHaveBeenCalledTimes(1);
      expect(update).not.toHaveBeenCalled();
    });

    it('rechaza un modelo que no pertenece al catálogo del proveedor', async () => {
      const { db } = makeDb([]);
      await expect(
        makeService(db).upsertGlobal('remedial', {
          provider: 'gemini',
          model: 'modelo-inexistente',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza un modelo sin imágenes para una funcionalidad multimodal', async () => {
      const { db, insert } = makeDb([]);
      await expect(
        makeService(db).upsertGlobal('answer_transcription', {
          provider: 'gemini',
          model: 'gemini-texto',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(insert).not.toHaveBeenCalled();
    });
  });
});
