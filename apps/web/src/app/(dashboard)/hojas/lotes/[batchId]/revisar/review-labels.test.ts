import {
  aiResolutionLabel,
  autoResolvedSummary,
  countAutoResolved,
  markOriginLabel,
} from './review-labels';

describe('aiResolutionLabel', () => {
  it('muestra la opción cuando coinciden los dos modelos', () => {
    expect(aiResolutionLabel({ verdict: 'agree', value: 'B', agreement: 'both' })).toBe(
      'IA: B (dos modelos coinciden)',
    );
  });

  it('muestra en blanco cuando un modelo está seguro', () => {
    expect(aiResolutionLabel({ verdict: 'solo_a', value: 'blank', agreement: 'single' })).toBe(
      'IA: en blanco (un modelo seguro)',
    );
  });

  it('muestra nula para el valor null', () => {
    expect(aiResolutionLabel({ verdict: 'solo_b', value: 'null', agreement: 'single' })).toBe(
      'IA: nula (un modelo seguro)',
    );
  });

  it('en conflicto no revela ningún valor', () => {
    expect(aiResolutionLabel({ verdict: 'conflict', value: null, agreement: null })).toBe(
      'Los modelos no coinciden',
    );
  });

  it('devuelve null sin resolución', () => {
    expect(aiResolutionLabel(null)).toBeNull();
  });
});

describe('markOriginLabel', () => {
  it('marca la doble marca evidente sin IA', () => {
    expect(markOriginLabel({ aiResolution: null, autoResolved: true })).toBe(
      'Doble marca evidente',
    );
  });

  it('prefiere la IA sobre la doble marca evidente', () => {
    expect(
      markOriginLabel({
        aiResolution: { verdict: 'agree', value: 'A', agreement: 'both' },
        autoResolved: true,
      }),
    ).toBe('IA: A (dos modelos coinciden)');
  });

  it('no muestra nada para una marca sin procedencia', () => {
    expect(markOriginLabel({ aiResolution: null, autoResolved: false })).toBeNull();
  });
});

describe('autoResolvedSummary', () => {
  const ai = { verdict: 'agree', value: 'A', agreement: 'both' } as const;

  it('cuenta las resueltas por IA y las evidentes', () => {
    const counts = countAutoResolved([
      { aiResolution: ai },
      { aiResolution: ai },
      { aiResolution: null },
    ]);
    expect(counts).toEqual({ byAi: 2, evident: 1 });
    expect(autoResolvedSummary(counts)).toBe(
      'Resueltas automáticamente: 2 por IA, 1 dobles marcas evidentes. No requieren revisión; quedan al final de la lista por si quieres corregir alguna.',
    );
  });

  it('sin IA conserva el texto previo y no la menciona', () => {
    const text = autoResolvedSummary({ byAi: 0, evident: 3 });
    expect(text).toContain('3 dobles marcas evidentes se anularon solas');
    expect(text).not.toMatch(/IA/);
  });
});
