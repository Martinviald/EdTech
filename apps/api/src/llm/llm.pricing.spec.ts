import { estimateLlmCostUsd, setCatalogTariffs } from './llm.pricing';

describe('estimateLlmCostUsd', () => {
  it('estima con 6 decimales por defecto', () => {
    expect(
      estimateLlmCostUsd('gemini-2.5-flash', { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBe('2.800000');
  });

  it('devuelve null sin modelo, sin uso o con modelo desconocido', () => {
    expect(estimateLlmCostUsd(null, { inputTokens: 10, outputTokens: 10 })).toBeNull();
    expect(estimateLlmCostUsd('gemini-2.5-flash', null)).toBeNull();
    expect(estimateLlmCostUsd('modelo-x', { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });

  it('Jev cobra solo el input y necesita 9 decimales', () => {
    expect(estimateLlmCostUsd('jev-1.13.0', { inputTokens: 1_000, outputTokens: 500 }, 9)).toBe(
      '0.000042000',
    );
    expect(estimateLlmCostUsd('jev-1.13.0', { inputTokens: 100, outputTokens: 0 })).toBe(
      '0.000004',
    );
    expect(estimateLlmCostUsd('jev-1.13.0', { inputTokens: 100, outputTokens: 0 }, 9)).toBe(
      '0.000004200',
    );
  });

  it.each([
    ['claude-haiku-5-5', '0.600000'],
    ['claude-haiku-4-5-20251001', '6.000000'],
    ['claude-sonnet-5-5', '12.000000'],
    ['claude-sonnet-5', '12.000000'],
    ['claude-sonnet-4-6', '18.000000'],
    ['claude-opus-5-5', '24.000000'],
    ['claude-opus-5', '30.000000'],
    ['claude-opus-4-8', '30.000000'],
    ['claude-opus-4-7', '30.000000'],
    ['claude-opus-4-6', '30.000000'],
    ['gemini-3.1-flash-lite', '1.750000'],
    ['gemini-3.5-flash-lite', '2.800000'],
    ['gemini-3.8-flash', '4.500000'],
    ['gemini-2.5-flash-lite', '0.500000'],
  ])('aplica la tarifa vigente de %s (1M de entrada + 1M de salida = %s USD)', (model, cost) => {
    expect(estimateLlmCostUsd(model, { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(
      cost,
    );
  });

  describe('con el catálogo de la BDD cargado', () => {
    beforeEach(() => {
      setCatalogTariffs(
        new Map([
          [
            'claude-haiku-5-5',
            { inputUsdPerMtok: 0.2, outputUsdPerMtok: 1, cachedInputUsdPerMtok: 0.02 },
          ],
          [
            'modelo-nuevo',
            { inputUsdPerMtok: 1, outputUsdPerMtok: 2, cachedInputUsdPerMtok: null },
          ],
        ]),
      );
    });

    afterEach(() => {
      setCatalogTariffs(new Map());
    });

    it('la tarifa del catálogo gana sobre la tarifa de respaldo en código', () => {
      expect(
        estimateLlmCostUsd('claude-haiku-5-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
      ).toBe('1.200000');
    });

    it('cobra un modelo que sólo existe en el catálogo', () => {
      expect(
        estimateLlmCostUsd('modelo-nuevo', { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
      ).toBe('3.000000');
    });

    it('cobra la entrada en caché con su tarifa propia', () => {
      expect(
        estimateLlmCostUsd('claude-haiku-5-5', {
          inputTokens: 1_000_000,
          outputTokens: 0,
          cachedInputTokens: 500_000,
        }),
      ).toBe('0.110000');
    });

    it('sin tarifa de caché cobra la entrada en caché como entrada normal', () => {
      expect(
        estimateLlmCostUsd('modelo-nuevo', {
          inputTokens: 1_000_000,
          outputTokens: 0,
          cachedInputTokens: 500_000,
        }),
      ).toBe('1.000000');
    });

    it('cae a la tarifa en código si el modelo no está en el catálogo', () => {
      expect(
        estimateLlmCostUsd('gemini-2.5-flash', { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
      ).toBe('2.800000');
    });
  });
});
