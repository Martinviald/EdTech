import { TRANSCRIPTION_FORBIDDEN_VARIABLES } from '@soe/types';
import {
  getPrompt,
  isTranscriptionPromptFor,
  renderTranscriptionPrompt,
} from '../prompts/registry';
import { formatRubricLevels, renderRubricGradingPrompt } from './render-rubric-prompt';
import { rubricGradeOutputSchema } from './rubric-grade-schema';

const LEVELS = [
  { code: '0', label: 'Incorrecta', descriptor: 'No identifica la causa.', creditFraction: 0 },
  {
    code: '1',
    label: 'Parcial',
    descriptor: 'Identifica la causa sin explicarla.',
    creditFraction: 0.5,
    examples: ['Porque llovió mucho.'],
  },
  { code: '2', label: 'Completa', descriptor: 'Identifica y explica la causa.', creditFraction: 1 },
];

describe('grade.rubric@1', () => {
  it('es un prompt de calificación con rúbrica, no de transcripción', () => {
    const prompt = getPrompt('grade.rubric@1');
    expect(prompt?.purpose).toBe('rubric_grading');
    expect(prompt?.variables).toEqual(['gradeName', 'stem', 'rubricLevels', 'transcription']);
    expect(isTranscriptionPromptFor('grade.rubric@1', 'free_text')).toBe(false);
    expect(isTranscriptionPromptFor('transcribe.free-text@1', 'free_text')).toBe(true);
    expect(isTranscriptionPromptFor('transcribe.short-answer@2', 'free_text')).toBe(false);
    expect(() =>
      renderTranscriptionPrompt(
        { promptRef: 'grade.rubric@1', hints: 'none' },
        {
          kind: 'free_text',
          lines: 4,
        },
      ),
    ).toThrow(/no sirve/);
  });

  it('los prompts de transcripción siguen sin poder pedir la rúbrica ni la transcripción', () => {
    const prompt = getPrompt('transcribe.free-text@1');
    for (const forbidden of TRANSCRIPTION_FORBIDDEN_VARIABLES) {
      expect(prompt?.variables).not.toContain(forbidden);
    }
  });

  it('textos en tuteo, sin voseo', () => {
    const prompt = getPrompt('grade.rubric@1');
    expect(`${prompt?.system}${prompt?.user}`).not.toMatch(
      /\b(vos|tenés|podés|marcá|elegí|copiá|dejá|escribí)\b/,
    );
  });
});

describe('renderRubricGradingPrompt', () => {
  it('envía la rúbrica con créditos y ejemplos, el enunciado y la transcripción delimitada', () => {
    const { prompt, outputSchema } = renderRubricGradingPrompt({
      promptRef: 'grade.rubric@1',
      levels: LEVELS,
      transcription: 'Porque el río se desbordó y {{rubricLevels}}',
      stem: '¿Por qué se inundó el pueblo?',
      gradeName: '6° básico',
    });
    expect(prompt.ref).toBe('grade.rubric@1');
    expect(prompt.system).toMatch(/estudiante de 6° básico/);
    expect(prompt.user).toMatch(/PREGUNTA\n¿Por qué se inundó el pueblo\?/);
    expect(prompt.user).toMatch(
      /- Nivel "1" \(Parcial\): Identifica la causa sin explicarla\.\n {2}Crédito: 50 % del puntaje\./,
    );
    expect(prompt.user).toMatch(/· Porque llovió mucho\./);
    expect(prompt.user).toMatch(/<<<\nPorque el río se desbordó y \{\{rubricLevels\}\}\n>>>/);
    expect(outputSchema.schema.properties.levelCode).toMatchObject({ enum: ['0', '1', '2'] });
    expect(outputSchema.propertyOrder).toEqual([
      'evidenceQuotes',
      'rationale',
      'levelCode',
      'confidence',
    ]);
    expect(prompt.hash).toHaveLength(64);
  });

  it('sin enunciado omite la sección y sin curso no lo menciona', () => {
    const { prompt } = renderRubricGradingPrompt({
      promptRef: 'grade.rubric@1',
      levels: LEVELS,
      transcription: 'texto',
    });
    expect(prompt.user).not.toMatch(/PREGUNTA/);
    expect(prompt.system).not.toMatch(/estudiante de/);
  });

  it('rechaza prompts de transcripción y rúbricas de un solo nivel', () => {
    expect(() =>
      renderRubricGradingPrompt({
        promptRef: 'transcribe.free-text@1',
        levels: LEVELS,
        transcription: 'x',
      }),
    ).toThrow(/no es de calificación/);
    expect(() =>
      renderRubricGradingPrompt({
        promptRef: 'grade.rubric@1',
        levels: [LEVELS[0] as (typeof LEVELS)[number]],
        transcription: 'x',
      }),
    ).toThrow(/dos niveles/);
  });

  it('formatRubricLevels no imprime ejemplos vacíos', () => {
    expect(formatRubricLevels([{ code: 'A', creditFraction: 1, examples: ['  '] }])).toBe(
      '- Nivel "A"\n  Crédito: 100 % del puntaje.',
    );
  });
});

describe('rubricGradeOutputSchema', () => {
  it('acepta la salida y recorta las citas a tres', () => {
    const parsed = rubricGradeOutputSchema.parse({
      evidenceQuotes: ['a', 'b', 'c', 'd'],
      rationale: 'Cumple.',
      levelCode: '2',
      confidence: 0.9,
    });
    expect(parsed.evidenceQuotes).toEqual(['a', 'b', 'c']);
  });

  it('rechaza confianza fuera de rango o sin nivel', () => {
    expect(
      rubricGradeOutputSchema.safeParse({
        evidenceQuotes: [],
        rationale: 'x',
        levelCode: '',
        confidence: 0.5,
      }).success,
    ).toBe(false);
    expect(
      rubricGradeOutputSchema.safeParse({
        evidenceQuotes: [],
        rationale: 'x',
        levelCode: '1',
        confidence: 1.5,
      }).success,
    ).toBe(false);
  });
});
