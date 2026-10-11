import { ConflictException, NotFoundException } from '@nestjs/common';
import type { LlmModelRow } from '@soe/db';
import { LlmModelsService } from './llm-models.service';
import { estimateLlmCostUsd, setCatalogTariffs } from './llm.pricing';
import type { Database } from '../database/database.types';

function makeRow(overrides: Partial<LlmModelRow> = {}): LlmModelRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    provider: 'anthropic',
    modelId: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    maxOutputTokens: 8192,
    supportsImages: true,
    supportsStructuredOutput: true,
    supportsBatch: true,
    inputUsdPerMtok: '0.100000',
    outputUsdPerMtok: '0.500000',
    cachedInputUsdPerMtok: null,
    batchDiscount: '0.500',
    enabled: true,
    deprecatedAt: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

function makeDb(rows: LlmModelRow[], options: { insertError?: unknown } = {}) {
  const select = jest.fn(() => ({
    from: () => ({ orderBy: () => Promise.resolve(rows) }),
  }));
  const values = jest.fn((input: Record<string, unknown>) => ({
    returning: () =>
      options.insertError
        ? Promise.reject(options.insertError)
        : Promise.resolve([makeRow({ ...(input as Partial<LlmModelRow>) })]),
  }));
  const insert = jest.fn(() => ({ values }));
  const set = jest.fn((input: Record<string, unknown>) => ({
    where: () => ({
      returning: () =>
        Promise.resolve(rows.length > 0 ? [makeRow(input as Partial<LlmModelRow>)] : []),
    }),
  }));
  const update = jest.fn(() => ({ set }));
  const db = { select, insert, update } as unknown as Database;
  return { db, select, values, set };
}

describe('LlmModelsService', () => {
  afterEach(() => {
    setCatalogTariffs(new Map());
  });

  it('agrupa por proveedor sólo los modelos habilitados y no deprecados', async () => {
    const { db } = makeDb([
      makeRow(),
      makeRow({ id: 'b', modelId: 'claude-viejo', enabled: false }),
      makeRow({ id: 'c', modelId: 'claude-retirado', deprecatedAt: new Date() }),
      makeRow({
        id: 'd',
        provider: 'gemini',
        modelId: 'gemini-3.5-flash-lite',
        label: 'Gemini 3.5 Flash-Lite',
        maxOutputTokens: 65536,
      }),
    ]);

    const byProvider = await new LlmModelsService(db).listEnabledByProvider();

    expect(byProvider).toEqual({
      anthropic: [
        { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', maxTokens: 8192, multimodal: true },
      ],
      gemini: [
        {
          id: 'gemini-3.5-flash-lite',
          label: 'Gemini 3.5 Flash-Lite',
          maxTokens: 65536,
          multimodal: true,
        },
      ],
    });
  });

  it('listAll devuelve todo el catálogo paginado con precios numéricos', async () => {
    const { db } = makeDb([makeRow(), makeRow({ id: 'b', modelId: 'x', enabled: false })]);

    const res = await new LlmModelsService(db).listAll();

    expect(res.total).toBe(2);
    expect(res.page).toBe(1);
    expect(res.limit).toBe(2);
    expect(res.data[0]).toMatchObject({
      modelId: 'claude-haiku-5-5',
      inputUsdPerMtok: 0.1,
      outputUsdPerMtok: 0.5,
      batchDiscount: 0.5,
      deprecatedAt: null,
      createdAt: '2026-10-01T00:00:00.000Z',
    });
  });

  it('cachea el catálogo y no vuelve a consultar la BDD dentro del TTL', async () => {
    const { db, select } = makeDb([makeRow()]);
    const service = new LlmModelsService(db);

    await service.resolveMaxTokens('anthropic', 'claude-haiku-5-5');
    await service.findSelectableModel('anthropic', 'claude-haiku-5-5');
    await service.listEnabledByProvider();

    expect(select).toHaveBeenCalledTimes(1);
  });

  it('resuelve el tope de tokens del catálogo o el de respaldo si no existe', async () => {
    const service = new LlmModelsService(makeDb([makeRow()]).db);

    await expect(service.resolveMaxTokens('anthropic', 'claude-haiku-5-5')).resolves.toBe(8192);
    await expect(service.resolveMaxTokens('gemini', 'gemini-inexistente')).resolves.toBe(4096);
  });

  it('findSelectableModel ignora los modelos deshabilitados', async () => {
    const service = new LlmModelsService(makeDb([makeRow({ enabled: false })]).db);

    await expect(service.findSelectableModel('anthropic', 'claude-haiku-5-5')).resolves.toBe(
      undefined,
    );
    await expect(service.findModel('anthropic', 'claude-haiku-5-5')).resolves.toMatchObject({
      enabled: false,
    });
  });

  it('publica las tarifas del catálogo para la estimación de costo', async () => {
    await new LlmModelsService(makeDb([makeRow({ modelId: 'modelo-solo-bdd' })]).db).onModuleInit();

    expect(
      estimateLlmCostUsd('modelo-solo-bdd', { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBe('0.600000');
  });

  it('crea un modelo con los precios como decimales e invalida la caché', async () => {
    const { db, values, select } = makeDb([makeRow()]);
    const service = new LlmModelsService(db);
    await service.listEnabledByProvider();

    const created = await service.create({
      provider: 'gemini',
      modelId: 'gemini-3.8-flash',
      label: 'Gemini 3.8 Flash',
      maxOutputTokens: 65536,
      supportsImages: true,
      supportsStructuredOutput: true,
      supportsBatch: true,
      inputUsdPerMtok: 0.75,
      outputUsdPerMtok: 3.75,
      cachedInputUsdPerMtok: null,
      batchDiscount: 0.5,
      enabled: true,
    });

    expect(values.mock.calls[0]?.[0]).toMatchObject({
      inputUsdPerMtok: '0.750000',
      outputUsdPerMtok: '3.750000',
      cachedInputUsdPerMtok: null,
      batchDiscount: '0.500',
    });
    expect(created.modelId).toBe('gemini-3.8-flash');
    await service.listEnabledByProvider();
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('responde 409 si el modelo ya existe para el proveedor', async () => {
    const { db } = makeDb([], { insertError: { code: '23505' } });

    await expect(
      new LlmModelsService(db).create({
        provider: 'anthropic',
        modelId: 'claude-haiku-5-5',
        label: 'Claude Haiku 5.5',
        maxOutputTokens: 8192,
        supportsImages: true,
        supportsStructuredOutput: true,
        supportsBatch: true,
        inputUsdPerMtok: 0.1,
        outputUsdPerMtok: 0.5,
        cachedInputUsdPerMtok: null,
        batchDiscount: null,
        enabled: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('update marca el modelo como deprecado y traduce los precios', async () => {
    const { db, set } = makeDb([makeRow()]);

    await new LlmModelsService(db).update('11111111-1111-4111-8111-111111111111', {
      deprecated: true,
      outputUsdPerMtok: 0.6,
    });

    const values = set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(values.deprecatedAt).toBeInstanceOf(Date);
    expect(values.outputUsdPerMtok).toBe('0.600000');
    expect(values).not.toHaveProperty('label');
  });

  it('update responde 404 si el modelo no existe', async () => {
    const { db } = makeDb([]);

    await expect(
      new LlmModelsService(db).update('11111111-1111-4111-8111-111111111111', { enabled: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
