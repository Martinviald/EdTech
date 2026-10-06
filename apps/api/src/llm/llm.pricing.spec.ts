import { estimateLlmCostUsd } from './llm.pricing';

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
});
