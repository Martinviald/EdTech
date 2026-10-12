import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import {
  evalLabelSchema,
  evalSampleSchema,
  fakeOutput,
  isSupportedFormat,
  labelAsOutput,
  labelTruth,
  normalizeTranscription,
  parseEvalManifest,
  requiresRubricGrading,
  toScoringOutcome,
  type TranscriptionImage,
} from '@soe/answer-reading';
import type {
  ItemContent,
  NormalizedAnswer,
  ReadingContext,
  ResponseFormat,
  ScoringOutcome,
  TranscriptionOutput,
} from '@soe/types';
import { z } from 'zod';
import {
  itemResponseFormat,
  scoreReadingValue,
  toReadingScoringItem,
  type ReadingScoringItem,
} from '../../src/answer-reading/answer-reading-scoring.helpers';

export const EVAL_MANIFEST_VERSIONS = [1, 2] as const;
export const EVAL_ORG_ID = '00000000-0000-4000-8000-0000000e7a10';
const EVAL_INSTRUMENT_ID = '00000000-0000-4000-8000-0000000e7a11';
const EVAL_ITEM_ID = '00000000-0000-4000-8000-0000000e7a12';

const MIME_BY_EXTENSION: Readonly<Record<string, TranscriptionImage['mimeType']>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

const datasetLabelSchema = evalLabelSchema.extend({
  parts: z.record(z.string(), z.string()).nullable().optional(),
});

const datasetItemSchema = z
  .object({
    id: z.string().uuid(),
    type: z.string().min(1),
    content: z.record(z.string(), z.unknown()),
    scoringConfig: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();

const datasetContextSchema = z
  .object({
    instrumentId: z.string().uuid().optional(),
    subjectId: z.string().uuid().nullable().optional(),
    gradeId: z.string().uuid().nullable().optional(),
  })
  .strict();

const injectedReadingSchema = z
  .object({
    literal: z.string().min(1),
    parts: z.record(z.string(), z.string()).nullable().optional(),
  })
  .strict();

export const datasetSampleSchema = evalSampleSchema.extend({
  label: datasetLabelSchema,
  injectedReading: injectedReadingSchema.optional(),
  item: datasetItemSchema.optional(),
  student: z.string().min(1).optional(),
  question: z.union([z.string().min(1), z.number()]).optional(),
  context: datasetContextSchema.optional(),
});
export type DatasetSample = z.infer<typeof datasetSampleSchema>;

export const datasetManifestSchema = z
  .object({
    manifestVersion: z.union([z.literal(1), z.literal(2)]),
    name: z.string().min(1),
    datasetVersion: z.string().min(1),
    description: z.string().optional(),
    samples: z.array(datasetSampleSchema).min(1),
  })
  .strict();
export type DatasetManifest = z.infer<typeof datasetManifestSchema>;

export type SampleGroup = 'short' | 'development' | 'unsupported';

export interface SampleTruth {
  readonly state: DatasetSample['label']['state'];
  readonly literal: string;
  readonly canonical: string | null;
  readonly answer: NormalizedAnswer | null;
}

export interface SampleScorer {
  outcome(answer: NormalizedAnswer): ScoringOutcome;
  points(answer: NormalizedAnswer): number | null;
}

export interface PreparedSample {
  readonly sample: DatasetSample;
  readonly image: TranscriptionImage | null;
  readonly imageError: string | null;
  readonly group: SampleGroup;
  readonly truth: SampleTruth;
  readonly scorer: SampleScorer;
  readonly expectedOutcome: ScoringOutcome | null;
  readonly expectedPoints: number | null;
  readonly maxPoints: number;
  readonly scoringFormat: ResponseFormat | null;
  readonly context: ReadingContext;
}

export interface LoadedDataset {
  readonly dir: string;
  readonly manifest: DatasetManifest;
  readonly samples: PreparedSample[];
}

function zodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`);
}

function sharedManifestChecks(manifest: DatasetManifest): string[] {
  const projected = {
    manifestVersion: 1,
    name: manifest.name,
    datasetVersion: manifest.datasetVersion,
    samples: manifest.samples.map((sample) => ({
      id: sample.id,
      image: sample.image,
      format: sample.format,
      label: { state: sample.label.state, literal: sample.label.literal },
    })),
  };
  const parsed = parseEvalManifest(projected);
  return parsed.ok ? [] : parsed.errors;
}

export function parseDatasetManifest(
  raw: unknown,
): { ok: true; manifest: DatasetManifest } | { ok: false; errors: string[] } {
  const parsed = datasetManifestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: zodIssues(parsed.error) };
  const errors = sharedManifestChecks(parsed.data);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, manifest: parsed.data };
}

function sampleGroup(format: ResponseFormat): SampleGroup {
  if (!isSupportedFormat(format)) return 'unsupported';
  return requiresRubricGrading(format) ? 'development' : 'short';
}

function scoringItemFor(sample: DatasetSample): ReadingScoringItem | null {
  if (sample.item) {
    return toReadingScoringItem({
      id: sample.item.id,
      type: sample.item.type,
      content: sample.item.content as ItemContent,
      scoringConfig: sample.item.scoringConfig,
    });
  }
  if (!sample.acceptedAnswers || sample.acceptedAnswers.length === 0) return null;
  return toReadingScoringItem({
    id: EVAL_ITEM_ID,
    type: 'short_answer',
    content: {
      prompt: sample.id,
      acceptedAnswers: sample.acceptedAnswers,
      responseFormat: sample.format,
    } as ItemContent,
    scoringConfig: sample.scoringConfig ?? null,
  });
}

function scorerFor(item: ReadingScoringItem | null, truthCanonical: string | null): SampleScorer {
  if (item === null) {
    const implicitCorrect = (answer: NormalizedAnswer) =>
      answer.canonical !== null && answer.canonical === truthCanonical;
    return {
      outcome: (answer) => (implicitCorrect(answer) ? 'correct' : 'incorrect'),
      points: (answer) => (implicitCorrect(answer) ? 1 : 0),
    };
  }
  return {
    outcome: (answer) => {
      const scored = scoreReadingValue(item, answer);
      return scored === null ? 'undecidable' : toScoringOutcome(scored.output);
    },
    points: (answer) => scoreReadingValue(item, answer)?.output.rawScore ?? null,
  };
}

function truthOutput(sample: DatasetSample): TranscriptionOutput {
  const { state, literal, parts } = sample.label;
  if (state !== 'answered') return fakeOutput('', { state, parts: parts ?? null, characters: [] });
  return fakeOutput(literal, parts ? { parts } : {});
}

export function labelReading(sample: DatasetSample): TranscriptionOutput {
  if (sample.label.state === 'answered' && !sample.label.parts) return labelAsOutput(sample);
  return truthOutput(sample);
}

function sampleTruth(sample: DatasetSample, group: SampleGroup): SampleTruth {
  const { state, literal } = sample.label;
  if (group !== 'short') {
    return { state, literal, canonical: sample.label.canonical ?? null, answer: null };
  }
  if (!sample.label.parts && state === 'answered') {
    const legacy = labelTruth(sample);
    return { state, literal, canonical: legacy.canonical, answer: legacy.normalized };
  }
  const answer = normalizeTranscription(truthOutput(sample), sample.format);
  const canonical = sample.label.canonical ?? answer.canonical;
  return { state, literal, canonical, answer };
}

function assertTruthConsistent(sample: DatasetSample, truth: SampleTruth): void {
  const declared = sample.label.canonical;
  if (declared === undefined || declared === null || truth.answer === null) return;
  if (truth.answer.state === 'answered' && truth.answer.canonical !== declared) {
    throw new Error(
      `Verdad inconsistente en ${sample.id}: el literal y las partes normalizan a ${String(truth.answer.canonical)}, no a ${declared}`,
    );
  }
}

function readingContextFor(sample: DatasetSample): ReadingContext {
  return {
    orgId: EVAL_ORG_ID,
    itemId: sample.item?.id ?? EVAL_ITEM_ID,
    instrumentId: sample.context?.instrumentId ?? EVAL_INSTRUMENT_ID,
    subjectId: sample.context?.subjectId ?? null,
    gradeId: sample.context?.gradeId ?? null,
    responseFormat: sample.format,
  };
}

export function prepareSample(
  sample: DatasetSample,
  image: TranscriptionImage | null,
  imageError: string | null,
): PreparedSample {
  const group = sampleGroup(sample.format);
  const truth = sampleTruth(sample, group);
  assertTruthConsistent(sample, truth);
  const item = scoringItemFor(sample);
  const scorer = scorerFor(item, truth.canonical);
  const scorable = group === 'short' && truth.answer !== null;
  const truthAnswer = scorable ? truth.answer : null;
  return {
    sample,
    image,
    imageError,
    group,
    truth,
    scorer,
    expectedOutcome: truthAnswer ? scorer.outcome(truthAnswer) : null,
    expectedPoints: truthAnswer ? scorer.points(truthAnswer) : null,
    maxPoints: item?.maxScore ?? 1,
    scoringFormat: item ? itemResponseFormat(item) : null,
    context: readingContextFor(sample),
  };
}

async function readImage(
  dir: string,
  sample: DatasetSample,
): Promise<{ image: TranscriptionImage | null; error: string | null }> {
  const mimeType = MIME_BY_EXTENSION[extname(sample.image).toLowerCase()];
  if (!mimeType) return { image: null, error: `Extensión no soportada: ${sample.image}` };
  try {
    const bytes = await readFile(join(dir, sample.image));
    return {
      image: {
        mimeType,
        base64: bytes.toString('base64'),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
      error: null,
    };
  } catch (error) {
    return { image: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function loadDataset(datasetDir: string): Promise<LoadedDataset> {
  const dir = resolve(datasetDir);
  const raw: unknown = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  const parsed = parseDatasetManifest(raw);
  if (!parsed.ok) throw new Error(`manifest.json inválido:\n- ${parsed.errors.join('\n- ')}`);
  const samples = await Promise.all(
    parsed.manifest.samples.map(async (sample) => {
      const { image, error } = await readImage(dir, sample);
      return prepareSample(sample, image, error);
    }),
  );
  return { dir, manifest: parsed.manifest, samples };
}
