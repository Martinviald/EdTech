import {
  TRANSCRIPTION_FORBIDDEN_VARIABLES,
  promptVersionSchema,
  type ReaderSpec,
  type ResponseFormat,
} from '@soe/types';
import { fakeOutput } from '../fake/fake-transcriber';
import lock from './prompts.lock.json';
import {
  PROMPT_LOCK_SAMPLE_FORMATS,
  PROMPT_VERSIONS,
  formatLockParts,
  getPrompt,
  promptLock,
  promptFormatLockHash,
  renderTranscriptionPrompt,
} from './registry';
import { promptRef, renderPrompt, renderTemplate, templateVariables } from './render';

const FRACTION: ResponseFormat = { kind: 'fraction', allowNegative: false, allowMixed: false };
const reader = (promptRefValue: string, hints: ReaderSpec['hints']) => ({
  promptRef: promptRefValue,
  hints,
});

describe('registro de prompts', () => {
  it('cada versión es válida y su referencia es única', () => {
    const refs = PROMPT_VERSIONS.map(promptRef);
    expect(new Set(refs).size).toBe(refs.length);
    for (const prompt of PROMPT_VERSIONS) {
      expect(promptVersionSchema.safeParse(prompt).success).toBe(true);
    }
    expect(getPrompt('transcribe.short-answer@2')?.version).toBe(2);
    expect(getPrompt('transcribe.short-answer@9')).toBeNull();
  });

  it('una versión publicada no cambia: su hash coincide con prompts.lock.json', () => {
    expect(promptLock()).toEqual(lock);
  });

  it('el lock cubre cada par prompt × formato, con la guía, la etiqueta y las partes', () => {
    const published = PROMPT_VERSIONS.filter(
      (prompt) => prompt.status === 'published' && prompt.purpose === 'transcription',
    );
    const pairs = published.flatMap((prompt) =>
      prompt.formatKinds
        .filter((kind) => PROMPT_LOCK_SAMPLE_FORMATS.some((format) => format.kind === kind))
        .map((kind) => `${promptRef(prompt)} × ${kind}`),
    );
    expect(Object.keys(lock)).toEqual(expect.arrayContaining(pairs));
    const v2 = getPrompt('transcribe.short-answer@2');
    if (!v2) throw new Error('falta v2');
    const parts = PROMPT_LOCK_SAMPLE_FORMATS.filter((f) => f.kind === 'fraction').map(
      formatLockParts,
    );
    const base = promptFormatLockHash(v2, parts);
    const [first, ...rest] = parts;
    if (!first) throw new Error('sin muestras de fracción');
    for (const change of [
      { ...first, guide: `${first.guide} ` },
      { ...first, label: `${first.label}.` },
      { ...first, outputSchema: { ...first.outputSchema, extra: true } },
    ]) {
      expect(promptFormatLockHash(v2, [change, ...rest])).not.toBe(base);
    }
  });

  it('un prompt de transcripción no declara variables de clave ni de respuesta modelo', () => {
    for (const prompt of PROMPT_VERSIONS.filter((p) => p.purpose === 'transcription')) {
      for (const forbidden of TRANSCRIPTION_FORBIDDEN_VARIABLES) {
        expect(prompt.variables).not.toContain(forbidden);
      }
    }
  });

  it('las plantillas solo usan variables declaradas', () => {
    for (const prompt of PROMPT_VERSIONS) {
      const used = [...templateVariables(prompt.system), ...templateVariables(prompt.user)];
      for (const name of used) expect(prompt.variables).toContain(name);
    }
  });

  it('v2 pide el análisis por carácter, el estado y la petición de revisión', () => {
    const v2 = getPrompt('transcribe.short-answer@2');
    expect(v2?.system).toMatch(/"characters"/);
    expect(v2?.system).toMatch(/"reviewRequested"/);
    expect(v2?.system).toMatch(/ESTADOS \("state"\)/);
    expect(v2?.system).not.toMatch(/\bvos\b|tenés|podés|marcá/);
  });
});

describe('prompts de texto (F10a)', () => {
  it('short-text@2 ignora los signos de operación impresos entre casillas', () => {
    const v1 = getPrompt('transcribe.short-text@1')?.system ?? '';
    const v2 = getPrompt('transcribe.short-text@2')?.system ?? '';
    expect(v2).not.toEqual(v1);
    expect(v2).toMatch(/signos de operación impresos entre casillas/);
    expect(v1).not.toMatch(/signos de operación/);
  });

  it('short-text atiende listas, texto corto y casillas; free-text atiende el desarrollo', () => {
    expect(getPrompt('transcribe.short-text@1')?.formatKinds).toEqual([
      'word_list',
      'short_text',
      'multi_box',
    ]);
    expect(getPrompt('transcribe.free-text@1')?.formatKinds).toEqual(['free_text', 'math_work']);
  });

  it('free-text conserva las faltas y marca [ilegible]; textos en tuteo', () => {
    for (const ref of ['transcribe.short-text@1', 'transcribe.free-text@1']) {
      const prompt = getPrompt(ref);
      expect(prompt?.system).toMatch(/"characters"/);
      expect(prompt?.system).toMatch(/ESTADOS \("state"\)/);
      expect(`${prompt?.system}${prompt?.user}`).not.toMatch(
        /\b(vos|tenés|podés|marcá|copiá|dejá|escribí)\b/,
      );
    }
    expect(getPrompt('transcribe.free-text@1')?.system).toMatch(/\[ilegible\]/);
    expect(getPrompt('transcribe.free-text@1')?.system).toMatch(/faltas de ortografía/);
  });

  it('renderiza el formato de casillas con sus partes', () => {
    const boxes: ResponseFormat = {
      kind: 'multi_box',
      boxes: [
        { partId: 'tens', label: 'Decenas', kind: 'integer' },
        { partId: 'units', label: 'Unidades', kind: 'integer' },
      ],
    };
    const { prompt, outputSchema } = renderTranscriptionPrompt(
      reader('transcribe.short-text@1', 'format'),
      boxes,
    );
    expect(prompt.user).toMatch(/2 casillas: Decenas, Unidades/);
    expect(prompt.system).toMatch(/"Decenas" \(número entero\)/);
    expect(outputSchema.schemaId).toBe('transcription-output.multi_box.tens+units@1');
    expect(() =>
      renderTranscriptionPrompt(reader('transcribe.short-answer@2', 'format'), boxes),
    ).toThrow(/no sirve/);
  });

  it('free-text no pide partes', () => {
    const { outputSchema } = renderTranscriptionPrompt(reader('transcribe.free-text@1', 'format'), {
      kind: 'free_text',
      lines: 6,
    });
    expect(outputSchema.schema.properties.parts).toMatchObject({ type: 'null' });
  });
});

describe('renderTemplate', () => {
  it('sustituye variables y secciones opcionales sin lógica', () => {
    expect(renderTemplate('Hola{{#gradeName}} de {{gradeName}}{{/gradeName}}.', {})).toBe('Hola.');
    expect(
      renderTemplate('Hola{{#gradeName}} de {{gradeName}}{{/gradeName}}.', {
        gradeName: '4° básico',
      }),
    ).toBe('Hola de 4° básico.');
    expect(renderTemplate('A\n\n{{formatGuide}}\n\nB', {})).toBe('A\n\nB');
  });
});

describe('renderPrompt / renderTranscriptionPrompt', () => {
  it('rechaza variables que la versión no declara', () => {
    const v1 = getPrompt('transcribe.short-answer@1');
    if (!v1) throw new Error('falta v1');
    expect(() => renderPrompt(v1, { formatGuide: 'x' }, { schemaId: 's', schema: {} })).toThrow(
      /no declaradas/,
    );
  });

  it('con hints "none" no envía pistas de formato', () => {
    const { prompt } = renderTranscriptionPrompt(
      reader('transcribe.short-answer@2', 'none'),
      FRACTION,
    );
    expect(prompt.user).not.toMatch(/Tipo de respuesta/);
    expect(prompt.system).not.toMatch(/numerador\/denominador \(por ejemplo 3\/4\), aunque/);
  });

  it('con hints "format" incluye etiqueta y guía del formato', () => {
    const { prompt, outputSchema } = renderTranscriptionPrompt(
      reader('transcribe.short-answer@2', 'format'),
      FRACTION,
      { gradeName: '6° básico' },
    );
    expect(prompt.ref).toBe('transcribe.short-answer@2');
    expect(prompt.user).toMatch(/Tipo de respuesta que pide la pregunta: fracción\./);
    expect(prompt.system).toMatch(/un estudiante de 6° básico\./);
    expect(prompt.system).toMatch(/"numerator" y "denominator"/);
    expect(prompt.outputSchemaId).toBe(outputSchema.schemaId);
    expect(prompt.hash).toHaveLength(64);
  });

  it('el hash es determinístico y cambia con lo que se envía', () => {
    const a = renderTranscriptionPrompt(reader('transcribe.short-answer@2', 'format'), FRACTION);
    const b = renderTranscriptionPrompt(reader('transcribe.short-answer@2', 'format'), FRACTION);
    const c = renderTranscriptionPrompt(reader('transcribe.short-answer@2', 'none'), FRACTION);
    expect(a.prompt.hash).toBe(b.prompt.hash);
    expect(a.prompt.hash).not.toBe(c.prompt.hash);
  });

  it('rechaza prompts inexistentes o de otro formato', () => {
    expect(() => renderTranscriptionPrompt(reader('nada@1', 'none'), FRACTION)).toThrow(
      /No existe/,
    );
    expect(() =>
      renderTranscriptionPrompt(reader('transcribe.short-answer@2', 'none'), {
        kind: 'free_text',
        lines: 3,
      }),
    ).toThrow(/no sirve/);
  });
});

describe('lectura por casilla (transcribe.boxes@1)', () => {
  const DECIMAL: ResponseFormat = { kind: 'decimal', maxChars: 6, allowNegative: false };

  it('describe las casillas con la geometría y pide una parte por casilla', () => {
    const { prompt, outputSchema, outputZodSchema } = renderTranscriptionPrompt(
      reader('transcribe.boxes@1', 'format'),
      DECIMAL,
      { gradeName: '6° Básico', geometry: { fractionDigits: 1 } },
    );
    expect(prompt.system).toMatch(/4 casillas, después una coma IMPRESA y después 1 casillas/);
    expect(prompt.system).toMatch(/punto, una mancha o una marca suelta/);
    expect(prompt.system).toMatch(/número de la pregunta/);
    expect(prompt.outputSchemaId).toBe('transcription-cells.decimal.i4f1@1');
    expect(outputSchema.schema.properties.parts).toMatchObject({
      required: ['i1', 'i2', 'i3', 'i4', 'f1'],
    });
    const cells = { i1: '', i2: '', i3: '2', i4: '7', f1: '5' };
    expect(outputZodSchema.safeParse({ ...fakeOutput('27,5'), parts: cells }).success).toBe(true);
    expect(outputZodSchema.safeParse(fakeOutput('27,5')).success).toBe(false);
  });

  it('sin geometría usa la de la hoja por defecto; con hints none no agrega la guía', () => {
    const fallback = renderTranscriptionPrompt(reader('transcribe.boxes@1', 'format'), DECIMAL);
    expect(fallback.prompt.outputSchemaId).toBe('transcription-cells.decimal.i3f2@1');
    const bare = renderTranscriptionPrompt(reader('transcribe.boxes@1', 'none'), DECIMAL, {
      geometry: { fractionDigits: 2 },
    });
    expect(bare.prompt.system).not.toMatch(/coma IMPRESA y después/);
    expect(bare.prompt.outputSchemaId).toBe('transcription-cells.decimal.i3f2@1');
  });

  it('la geometría no cambia lo que se envía con los prompts que no leen por casilla', () => {
    const plain = renderTranscriptionPrompt(reader('transcribe.short-answer@2', 'none'), DECIMAL);
    const withGeometry = renderTranscriptionPrompt(
      reader('transcribe.short-answer@2', 'none'),
      DECIMAL,
      { geometry: { fractionDigits: 1 } },
    );
    expect(withGeometry.prompt).toEqual(plain.prompt);
    expect(withGeometry.outputSchema).toEqual(plain.outputSchema);
  });

  it('atiende enteros, decimales y secuencias, y no fracciones', () => {
    expect(getPrompt('transcribe.boxes@1')?.formatKinds).toEqual([
      'integer',
      'decimal',
      'sequence',
    ]);
    expect(() =>
      renderTranscriptionPrompt(reader('transcribe.boxes@1', 'format'), FRACTION),
    ).toThrow(/no sirve/);
  });
});
