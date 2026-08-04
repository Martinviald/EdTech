import { safeValidateItemContent } from '@soe/types';
import { parseDiaPayload } from './dia-parser';
import { SAMPLE_LECTURA_2BASICO, SAMPLE_MATEMATICA_4BASICO } from './dia-sample-data';
import type { DiaRawPayload } from './dia-sample-data';

describe('parseDiaPayload', () => {
  it('should parse a valid lectura payload with 20 items', () => {
    const result = parseDiaPayload(SAMPLE_LECTURA_2BASICO);

    expect(result.errors).toHaveLength(0);
    expect(result.items).toHaveLength(20);
    expect(result.instrument.name).toBe('DIA Lectura 2° Básico 2025 - Diagnóstico');
    expect(result.instrument.subject).toBe('Lenguaje y Comunicación');
    expect(result.instrument.year).toBe(2025);
  });

  it('should parse a valid matematica payload with 25 items', () => {
    const result = parseDiaPayload(SAMPLE_MATEMATICA_4BASICO);

    expect(result.errors).toHaveLength(0);
    expect(result.items).toHaveLength(25);
    expect(result.instrument.subject).toBe('Matemática');
    expect(result.instrument.grade).toBe('4° Básico');
  });

  it('should set type to multiple_choice for all items', () => {
    const result = parseDiaPayload(SAMPLE_LECTURA_2BASICO);

    for (const item of result.items) {
      expect(item.type).toBe('multiple_choice');
    }
  });

  it('should correctly extract content from items', () => {
    const result = parseDiaPayload(SAMPLE_LECTURA_2BASICO);
    const firstItem = result.items[0];

    expect(firstItem.position).toBe(1);
    expect(firstItem.correctKey).toBe('B');
    expect(firstItem.content.alternatives).toHaveLength(4);
    expect(firstItem.content.stem).toBe('¿Qué hacía el gato en la historia?');
    expect(firstItem.skillName).toBe('Localizar información explícita');
    expect(firstItem.oaCode).toBe('OA 3');
    expect(firstItem.contentAxis).toBe('Lectura');
  });

  // ── Shape canónico @soe/types ──────────────────────────────────────────────

  it('should produce canonical content that passes validateItemContent(multiple_choice)', () => {
    const result = parseDiaPayload(SAMPLE_LECTURA_2BASICO);

    for (const item of result.items) {
      const validation = safeValidateItemContent(item.type, item.content);
      expect(validation.success).toBe(true);
    }
  });

  it('should derive isCorrect on the alternative matching correctKey (and only that one)', () => {
    const result = parseDiaPayload(SAMPLE_LECTURA_2BASICO);
    const firstItem = result.items[0]; // correctKey 'B'

    const correctAlts = firstItem.content.alternatives.filter((a) => a.isCorrect);
    expect(correctAlts).toHaveLength(1);
    expect(correctAlts[0].key).toBe('B');

    // El resto debe quedar isCorrect=false
    const wrong = firstItem.content.alternatives.filter((a) => !a.isCorrect);
    expect(wrong.every((a) => a.key !== 'B')).toBe(true);
  });

  it('should not leak correctKey into the canonical content object', () => {
    const result = parseDiaPayload(SAMPLE_LECTURA_2BASICO);
    expect('correctKey' in result.items[0].content).toBe(false);
  });

  // ── Claves configurables (≥2 alternativas, A–E, V/F) ───────────────────────

  it('should accept a 5-alternative (A–E) item, e.g. PAES-style', () => {
    const payload: DiaRawPayload = {
      instrument: { name: 'PAES', subject: 'Matemática', grade: 'IV Medio', year: 2025, applicationPeriod: 'regular' },
      items: [
        {
          position: 1,
          correctKey: 'E',
          alternatives: [{ key: 'A' }, { key: 'B' }, { key: 'C' }, { key: 'D' }, { key: 'E' }],
          skill: 'Resolver problemas',
        },
      ],
    };

    const result = parseDiaPayload(payload);
    expect(result.errors).toHaveLength(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].content.alternatives).toHaveLength(5);
    expect(result.items[0].correctKey).toBe('E');
    expect(result.items[0].content.alternatives.find((a) => a.isCorrect)?.key).toBe('E');
    expect(safeValidateItemContent('multiple_choice', result.items[0].content).success).toBe(true);
  });

  it('should accept custom valid keys via options (e.g. true/false V/F)', () => {
    const payload: DiaRawPayload = {
      instrument: { name: 'VF', subject: 'Ciencias', grade: '6° Básico', year: 2025, applicationPeriod: 'diagnostico' },
      items: [
        {
          position: 1,
          correctKey: 'V',
          alternatives: [{ key: 'V', text: 'Verdadero' }, { key: 'F', text: 'Falso' }],
          skill: 'Comprender',
        },
      ],
    };

    const result = parseDiaPayload(payload, { validKeys: ['V', 'F'] });
    expect(result.errors).toHaveLength(0);
    expect(result.items[0].correctKey).toBe('V');
    expect(result.items[0].content.alternatives.find((a) => a.isCorrect)?.key).toBe('V');
  });

  it('should reject a correctKey outside the explicit valid keys set', () => {
    const payload: DiaRawPayload = {
      instrument: { name: 'VF', subject: 'Ciencias', grade: '6° Básico', year: 2025, applicationPeriod: 'diagnostico' },
      items: [
        { position: 1, correctKey: 'A', alternatives: [{ key: 'V' }, { key: 'F' }], skill: 'Comprender' },
      ],
    };

    const result = parseDiaPayload(payload, { validKeys: ['V', 'F'] });
    expect(result.errors.some((e) => e.field === 'correctKey')).toBe(true);
    expect(result.items).toHaveLength(0);
  });

  // ── Validaciones existentes (cero regresión) ───────────────────────────────

  it('should report error for missing instrument name', () => {
    const payload: DiaRawPayload = {
      instrument: { name: '', subject: 'Lenguaje', grade: '2° Básico', year: 2025, applicationPeriod: 'diagnostico' },
      items: [
        { position: 1, correctKey: 'A', alternatives: [{ key: 'A' }, { key: 'B' }, { key: 'C' }, { key: 'D' }], skill: 'Localizar' },
      ],
    };

    const result = parseDiaPayload(payload);
    expect(result.errors.some((e) => e.field === 'instrument.name')).toBe(true);
  });

  it('should report error for invalid year', () => {
    const payload: DiaRawPayload = {
      instrument: { name: 'Test', subject: 'Lenguaje', grade: '2° Básico', year: 1999, applicationPeriod: 'diagnostico' },
      items: [
        { position: 1, correctKey: 'A', alternatives: [{ key: 'A' }, { key: 'B' }, { key: 'C' }, { key: 'D' }], skill: 'Localizar' },
      ],
    };

    const result = parseDiaPayload(payload);
    expect(result.errors.some((e) => e.field === 'instrument.year')).toBe(true);
  });

  it('should report error for empty items array', () => {
    const payload: DiaRawPayload = {
      instrument: { name: 'Test', subject: 'Lenguaje', grade: '2° Básico', year: 2025, applicationPeriod: 'diagnostico' },
      items: [],
    };

    const result = parseDiaPayload(payload);
    expect(result.errors.some((e) => e.field === 'items')).toBe(true);
    expect(result.items).toHaveLength(0);
  });

  it('should report error for invalid correctKey (default A–D derived from alternatives)', () => {
    const payload: DiaRawPayload = {
      instrument: { name: 'Test', subject: 'Lenguaje', grade: '2° Básico', year: 2025, applicationPeriod: 'diagnostico' },
      items: [
        { position: 1, correctKey: 'X', alternatives: [{ key: 'A' }, { key: 'B' }, { key: 'C' }, { key: 'D' }], skill: 'Localizar' },
      ],
    };

    const result = parseDiaPayload(payload);
    expect(result.errors.some((e) => e.field === 'correctKey')).toBe(true);
    expect(result.items).toHaveLength(0);
  });

  it('should report error when correctKey is not among alternatives', () => {
    const payload: DiaRawPayload = {
      instrument: { name: 'Test', subject: 'Lenguaje', grade: '2° Básico', year: 2025, applicationPeriod: 'diagnostico' },
      items: [
        { position: 1, correctKey: 'D', alternatives: [{ key: 'A' }, { key: 'B' }, { key: 'C' }], skill: 'Localizar' },
      ],
    };

    const result = parseDiaPayload(payload);
    expect(result.errors.some((e) => e.message.includes('no está entre las alternativas'))).toBe(true);
  });

  it('should report error for missing skill', () => {
    const payload: DiaRawPayload = {
      instrument: { name: 'Test', subject: 'Lenguaje', grade: '2° Básico', year: 2025, applicationPeriod: 'diagnostico' },
      items: [
        { position: 1, correctKey: 'A', alternatives: [{ key: 'A' }, { key: 'B' }, { key: 'C' }, { key: 'D' }], skill: '' },
      ],
    };

    const result = parseDiaPayload(payload);
    expect(result.errors.some((e) => e.field === 'skill')).toBe(true);
  });

  it('should skip invalid items but parse valid ones', () => {
    const payload: DiaRawPayload = {
      instrument: { name: 'Test', subject: 'Lenguaje', grade: '2° Básico', year: 2025, applicationPeriod: 'diagnostico' },
      items: [
        { position: 1, correctKey: 'X', alternatives: [{ key: 'A' }, { key: 'B' }], skill: 'Localizar' }, // invalid
        { position: 2, correctKey: 'A', alternatives: [{ key: 'A' }, { key: 'B' }, { key: 'C' }, { key: 'D' }], skill: 'Interpretar' }, // valid
      ],
    };

    const result = parseDiaPayload(payload);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].position).toBe(2);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should handle lowercase correctKey by uppercasing', () => {
    const payload: DiaRawPayload = {
      instrument: { name: 'Test', subject: 'Lenguaje', grade: '2° Básico', year: 2025, applicationPeriod: 'diagnostico' },
      items: [
        { position: 1, correctKey: 'b', alternatives: [{ key: 'A' }, { key: 'B' }, { key: 'C' }, { key: 'D' }], skill: 'Localizar' },
      ],
    };

    const result = parseDiaPayload(payload);
    expect(result.errors).toHaveLength(0);
    expect(result.items[0].correctKey).toBe('B');
    expect(result.items[0].content.alternatives.find((a) => a.isCorrect)?.key).toBe('B');
  });

  it('should use default stem when not provided', () => {
    const payload: DiaRawPayload = {
      instrument: { name: 'Test', subject: 'Lenguaje', grade: '2° Básico', year: 2025, applicationPeriod: 'diagnostico' },
      items: [
        { position: 3, correctKey: 'A', alternatives: [{ key: 'A' }, { key: 'B' }, { key: 'C' }, { key: 'D' }], skill: 'Localizar' },
      ],
    };

    const result = parseDiaPayload(payload);
    expect(result.items[0].content.stem).toBe('Pregunta 3');
  });
});
