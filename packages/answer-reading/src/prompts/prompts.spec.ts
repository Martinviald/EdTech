import {
  TRANSCRIPTION_FORBIDDEN_VARIABLES,
  promptVersionSchema,
  type ReaderSpec,
  type ResponseFormat,
} from '@soe/types';
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
    const published = PROMPT_VERSIONS.filter((prompt) => prompt.status === 'published');
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
