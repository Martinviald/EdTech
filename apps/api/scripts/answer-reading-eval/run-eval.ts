import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import {
  FakeTranscriber,
  buildEvalReport,
  compareEvalReports,
  isEvaluableFormat,
  labelAsOutput,
  parseEvalManifest,
  readingKeyFor,
  renderEvalMarkdown,
  runEvaluation,
  type EvalBudget,
  type EvalComparison,
  type EvalManifest,
  type EvalReport,
  type EvalSampleInput,
  type EvalTranscriber,
  type FakeReading,
  type TranscriptionImage,
} from '@soe/answer-reading';
import { readingRouteSchema, type ReaderSpec, type ReadingRoute } from '@soe/types';

export const REPORT_FILE = 'informe.json';
export const SUMMARY_FILE = 'resumen.md';
export const COMPARISON_FILE = 'comparacion.json';

const MIME_BY_EXTENSION: Readonly<Record<string, TranscriptionImage['mimeType']>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

export interface LoadedDataset {
  readonly dir: string;
  readonly manifest: EvalManifest;
  readonly inputs: EvalSampleInput[];
}

export async function loadDataset(datasetDir: string): Promise<LoadedDataset> {
  const dir = resolve(datasetDir);
  const raw: unknown = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  const parsed = parseEvalManifest(raw);
  if (!parsed.ok) {
    throw new Error(`manifest.json inválido:\n- ${parsed.errors.join('\n- ')}`);
  }
  const inputs = await Promise.all(
    parsed.manifest.samples.map(async (sample): Promise<EvalSampleInput> => {
      const mimeType = MIME_BY_EXTENSION[extname(sample.image).toLowerCase()];
      if (!mimeType) {
        return { sample, image: null, imageError: `Extensión no soportada: ${sample.image}` };
      }
      try {
        const bytes = await readFile(join(dir, sample.image));
        return {
          sample,
          image: {
            mimeType,
            base64: bytes.toString('base64'),
            sha256: createHash('sha256').update(bytes).digest('hex'),
          },
        };
      } catch (error) {
        return {
          sample,
          image: null,
          imageError: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  return { dir, manifest: parsed.manifest, inputs };
}

export async function loadRoute(routeFile: string): Promise<ReadingRoute> {
  const raw: unknown = JSON.parse(await readFile(resolve(routeFile), 'utf8'));
  const parsed = readingRouteSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Ruta inválida (${routeFile}):\n- ${issues.join('\n- ')}`);
  }
  return parsed.data;
}

export function routeReaders(route: ReadingRoute): ReaderSpec[] {
  return route.policy.tiebreakReader
    ? [...route.readers, route.policy.tiebreakReader]
    : [...route.readers];
}

export function dryRunTranscribers(
  route: ReadingRoute,
  inputs: readonly EvalSampleInput[],
): (reader: ReaderSpec) => EvalTranscriber | null {
  const byReadingKey: Record<string, FakeReading> = {};
  for (const input of inputs) {
    if (input.image === null || !isEvaluableFormat(input.sample.format)) continue;
    byReadingKey[readingKeyFor(input.sample, input.image)] = labelAsOutput(input.sample);
  }
  const fakes = new Map<string, FakeTranscriber>();
  for (const reader of routeReaders(route)) {
    if (!fakes.has(reader.transcriberId)) {
      fakes.set(
        reader.transcriberId,
        new FakeTranscriber({ id: reader.transcriberId, byReadingKey }),
      );
    }
  }
  return (reader) => fakes.get(reader.transcriberId) ?? null;
}

export interface EvalCommandOptions {
  readonly datasetDir: string;
  readonly routeFile: string;
  readonly repetitions: number;
  readonly concurrency: number;
  readonly outDir: string;
  readonly dryRun: boolean;
  readonly budgetUsd: number | null;
  readonly compareFile: string | null;
}

export interface EvalCommandDeps {
  readonly transcriberFor?: (reader: ReaderSpec) => EvalTranscriber | null;
  readonly estimateCallUsd?: EvalBudget['estimateCallUsd'];
  readonly log?: (message: string) => void;
}

export interface EvalCommandResult {
  readonly report: EvalReport;
  readonly comparison: EvalComparison | null;
  readonly files: readonly string[];
}

function assertReadersCovered(
  readers: readonly ReaderSpec[],
  transcriberFor: (reader: ReaderSpec) => EvalTranscriber | null,
): void {
  const missing = readers.filter((reader) => {
    const transcriber = transcriberFor(reader);
    return !transcriber || !transcriber.supports(reader);
  });
  if (missing.length > 0) {
    throw new Error(
      `No hay transcriptor disponible para: ${missing.map((r) => `${r.key} (${r.provider})`).join(', ')}`,
    );
  }
}

export async function runEvalCommand(
  options: EvalCommandOptions,
  deps: EvalCommandDeps = {},
): Promise<EvalCommandResult> {
  const log = deps.log ?? (() => undefined);
  const [dataset, route] = await Promise.all([
    loadDataset(options.datasetDir),
    loadRoute(options.routeFile),
  ]);
  const previous = options.compareFile
    ? (JSON.parse(await readFile(resolve(options.compareFile), 'utf8')) as EvalReport)
    : null;
  const transcriberFor = options.dryRun
    ? dryRunTranscribers(route, dataset.inputs)
    : deps.transcriberFor;
  if (!transcriberFor) throw new Error('Sin --dry-run hace falta un transcriptor real');
  assertReadersCovered(routeReaders(route), transcriberFor);
  const budget: EvalBudget | undefined =
    options.budgetUsd !== null && deps.estimateCallUsd && !options.dryRun
      ? { limitUsd: options.budgetUsd, estimateCallUsd: deps.estimateCallUsd }
      : undefined;

  const startedAt = new Date().toISOString();
  log(
    `Dataset ${dataset.manifest.name} v${dataset.manifest.datasetVersion}: ${dataset.inputs.length} muestras × ${options.repetitions} repeticiones`,
  );
  const run = await runEvaluation({
    samples: dataset.inputs,
    readers: route.readers,
    policy: route.policy,
    repetitions: options.repetitions,
    concurrency: options.concurrency,
    transcriberFor,
    budget,
    onUnitDone: ({ done, total, spentUsd }) =>
      log(`  ${done}/${total} · US$${spentUsd.toFixed(5)}`),
  });
  const report = buildEvalReport(
    {
      datasetName: dataset.manifest.name,
      datasetVersion: dataset.manifest.datasetVersion,
      routeId: route.id,
      routeVersion: route.version,
      readers: route.readers,
      policy: route.policy,
      repetitions: options.repetitions,
      dryRun: options.dryRun,
      budgetUsd: budget ? budget.limitUsd : null,
      stoppedByBudget: run.stoppedByBudget,
      startedAt,
      finishedAt: new Date().toISOString(),
    },
    run.samples,
  );
  const comparison = previous ? compareEvalReports(previous, report) : null;

  await mkdir(options.outDir, { recursive: true });
  const files = [join(options.outDir, REPORT_FILE), join(options.outDir, SUMMARY_FILE)];
  await writeFile(files[0]!, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(files[1]!, renderEvalMarkdown(report, comparison ?? undefined), 'utf8');
  if (comparison) {
    const comparisonFile = join(options.outDir, COMPARISON_FILE);
    await writeFile(comparisonFile, `${JSON.stringify(comparison, null, 2)}\n`, 'utf8');
    files.push(comparisonFile);
  }
  return { report, comparison, files };
}
