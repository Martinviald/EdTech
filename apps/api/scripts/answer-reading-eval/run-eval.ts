import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FakeTranscriber, readingKeyFor, type FakeReading } from '@soe/answer-reading';
import type { ReaderSpec } from '@soe/types';
import { labelReading, loadDataset, type LoadedDataset } from './dataset';
import { comparePaired, computeMetrics, type PairedComparison } from './metrics';
import { ReadingCache, type CacheMode } from './reading-cache';
import { EVAL_REPORT_VERSION, renderReportMarkdown, type EvalReportV2 } from './report';
import { loadRouteSet, type ReaderMinConfidence, type RouteSet } from './route-set';
import {
  planReadings,
  planSamples,
  runSimulation,
  type HarnessTranscriber,
  type SimulationBudget,
  type InterpretationSimulation,
} from './simulate';

export const REPORT_FILE = 'informe.json';
export const SUMMARY_FILE = 'informe.md';
export const COMPARISON_FILE = 'comparacion.json';

export interface EvalCommandOptions {
  readonly datasetDir: string;
  readonly routesFile: string;
  readonly repetitions: number;
  readonly concurrency: number;
  readonly outDir: string;
  readonly dryRun: boolean;
  readonly budgetUsd: number | null;
  readonly compareFile: string | null;
  readonly cacheDir: string | null;
  readonly cacheMode: CacheMode;
  readonly readerMinConfidence: ReaderMinConfidence | null;
  readonly injectedEscalation?: boolean;
  readonly offline?: boolean;
}

export interface EvalCommandDeps {
  readonly transcriberFor?: (reader: ReaderSpec) => HarnessTranscriber | null;
  readonly interpretation?: InterpretationSimulation | null;
  readonly estimateCallUsd?: SimulationBudget['estimateCallUsd'];
  readonly log?: (message: string) => void;
}

export interface EvalCommandResult {
  readonly report: EvalReportV2;
  readonly comparison: PairedComparison | null;
  readonly files: readonly string[];
  readonly cacheStats: { hits: number; misses: number; writes: number };
}

export function dryRunTranscribers(
  dataset: LoadedDataset,
): (reader: ReaderSpec) => HarnessTranscriber | null {
  const byReadingKey: Record<string, FakeReading> = {};
  for (const prepared of dataset.samples) {
    if (prepared.image === null || prepared.group === 'unsupported') continue;
    byReadingKey[readingKeyFor(prepared.sample, prepared.image)] = labelReading(prepared.sample);
  }
  const fakes = new Map<string, FakeTranscriber>();
  return (reader) => {
    const existing = fakes.get(reader.transcriberId);
    if (existing) return existing;
    const fake = new FakeTranscriber({ id: reader.transcriberId, byReadingKey });
    fakes.set(reader.transcriberId, fake);
    return fake;
  };
}

function assertReadersCovered(
  readers: readonly ReaderSpec[],
  transcriberFor: (reader: ReaderSpec) => HarnessTranscriber | null,
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

function assertVerifiersCovered(
  verifiers: readonly ReaderSpec[],
  transcriberFor: (reader: ReaderSpec) => HarnessTranscriber | null,
): void {
  const missing = verifiers.filter((reader) => {
    const transcriber = transcriberFor(reader);
    return !transcriber || !transcriber.supports(reader) || !transcriber.verify;
  });
  if (missing.length > 0) {
    throw new Error(
      `No hay verificador disponible para: ${missing.map((r) => `${r.key} (${r.provider})`).join(', ')}`,
    );
  }
}

function assertAuditorsCovered(
  auditors: readonly ReaderSpec[],
  transcriberFor: (reader: ReaderSpec) => HarnessTranscriber | null,
): void {
  const missing = auditors.filter((reader) => {
    const transcriber = transcriberFor(reader);
    return !transcriber || !transcriber.supports(reader) || !transcriber.audit;
  });
  if (missing.length > 0) {
    throw new Error(
      `No hay auditor de lectura disponible para: ${missing.map((r) => `${r.key} (${r.provider})`).join(', ')}`,
    );
  }
}

async function missingReadings(
  dataset: LoadedDataset,
  routeSet: RouteSet,
  repetitions: number,
  cache: ReadingCache,
) {
  const planned = planReadings(planSamples(dataset.samples, routeSet), repetitions);
  const present = await Promise.all(planned.map((reading) => cache.has(reading.cacheKey)));
  return {
    planned,
    missing: planned.filter((_, index) => !present[index]),
  };
}

function uniqueReaders(readers: readonly ReaderSpec[]): ReaderSpec[] {
  return [...new Map(readers.map((reader) => [`${reader.key}|${reader.model}`, reader])).values()];
}

async function loadPrevious(compareFile: string): Promise<EvalReportV2> {
  const previous = JSON.parse(
    await readFile(resolve(compareFile), 'utf8'),
  ) as Partial<EvalReportV2>;
  if (previous.meta?.reportVersion !== EVAL_REPORT_VERSION || !Array.isArray(previous.units)) {
    throw new Error(
      `${compareFile} no es un informe v${EVAL_REPORT_VERSION} del arnés (le faltan las unidades)`,
    );
  }
  return previous as EvalReportV2;
}

export async function runEvalCommand(
  options: EvalCommandOptions,
  deps: EvalCommandDeps = {},
): Promise<EvalCommandResult> {
  const log = deps.log ?? (() => undefined);
  const [dataset, routeSet] = await Promise.all([
    loadDataset(options.datasetDir),
    loadRouteSet(options.routesFile),
  ]);
  const previous = options.compareFile ? await loadPrevious(options.compareFile) : null;
  const offline = options.offline === true && !options.dryRun;
  const transcriberFor = options.dryRun
    ? dryRunTranscribers(dataset)
    : offline
      ? () => null
      : deps.transcriberFor;
  if (!transcriberFor)
    throw new Error('Sin --dry-run ni --offline hace falta un transcriptor real');
  const cacheMode: CacheMode = options.dryRun ? 'off' : options.cacheMode;
  const cache = new ReadingCache(options.cacheDir, cacheMode);

  const { planned, missing } = await missingReadings(dataset, routeSet, options.repetitions, cache);
  const verifiers = uniqueReaders(
    routeSet.routes.flatMap((route) =>
      route.policy.incorrectVerifier ? [route.policy.incorrectVerifier] : [],
    ),
  );
  const auditors = uniqueReaders(
    routeSet.routes.flatMap((route) =>
      route.policy.readingAuditor ? [route.policy.readingAuditor.reader] : [],
    ),
  );
  if (!options.dryRun && !offline) {
    assertReadersCovered(uniqueReaders(missing.map((reading) => reading.reader)), transcriberFor);
    assertVerifiersCovered(verifiers, transcriberFor);
    assertAuditorsCovered(auditors, transcriberFor);
    if (verifiers.length > 0 && options.budgetUsd === null) {
      throw new Error(
        'Las rutas traen verificador de incorrectas: fija --budget-usd (sus llamadas no se estiman de antemano)',
      );
    }
    if (auditors.length > 0 && options.budgetUsd === null) {
      throw new Error(
        'Las rutas traen auditor de lectura: fija --budget-usd (sus llamadas no se estiman de antemano)',
      );
    }
  }
  const estimate = deps.estimateCallUsd;
  const required = missing.filter((reading) => reading.role === 'primary');
  const conditional = missing.length - required.length;
  const missingUsd = estimate
    ? required.reduce((sum, reading) => sum + estimate(reading.reader, []), 0)
    : 0;
  log(
    `Dataset ${dataset.manifest.name} v${dataset.manifest.datasetVersion}: ${dataset.samples.length} muestras × ${options.repetitions} repeticiones; ${planned.length} lecturas, ${planned.length - missing.length} en caché, ${required.length} por pedir (peor caso US$${missingUsd.toFixed(4)}) y ${conditional} de desempate que solo se piden si hacen falta, dentro del tope`,
  );
  if (offline && missing.length > 0) {
    log(
      `Modo offline: ${missing.length} lecturas no están en el caché y quedan como falla del lector (no se llama a ninguna API)`,
    );
  }
  if (!options.dryRun && !offline && missing.length > 0) {
    if (options.budgetUsd === null) {
      throw new Error('Faltan lecturas en el caché: fija --budget-usd para pedirlas');
    }
    if (estimate && missingUsd > options.budgetUsd) {
      throw new Error(
        `Pedir las ${required.length} lecturas que faltan costaría hasta US$${missingUsd.toFixed(4)} (peor caso), sobre el tope de US$${options.budgetUsd}. Sube el tope o reduce las repeticiones.`,
      );
    }
  }
  const budget: SimulationBudget | null =
    !options.dryRun && !offline && options.budgetUsd !== null && estimate
      ? { limitUsd: options.budgetUsd, estimateCallUsd: estimate }
      : null;

  const startedAt = new Date().toISOString();
  const simulation = await runSimulation({
    samples: dataset.samples,
    routeSet,
    repetitions: options.repetitions,
    concurrency: options.concurrency,
    readerMinConfidence: options.readerMinConfidence,
    injectedEscalation: options.injectedEscalation ?? false,
    interpretation: deps.interpretation ?? null,
    transcriberFor,
    cache,
    budget,
    onUnitDone: ({ done, total, spentUsd }) =>
      log(`  ${done}/${total} · gastado US$${spentUsd.toFixed(5)}`),
  });
  const report: EvalReportV2 = {
    meta: {
      reportVersion: EVAL_REPORT_VERSION,
      datasetName: dataset.manifest.name,
      datasetVersion: dataset.manifest.datasetVersion,
      routesFile: routeSet.file,
      routesDescription: routeSet.description,
      routes: routeSet.routes.map((route) => ({
        id: route.id,
        version: route.version,
        status: route.status,
        level: route.level,
        formatKind: route.formatKind,
        readers: route.readers.map((reader) => `${reader.key}:${reader.promptRef}:${reader.hints}`),
        minConfidence: route.policy.minConfidence,
      })),
      readerMinConfidence: options.readerMinConfidence,
      repetitions: options.repetitions,
      dryRun: options.dryRun,
      cacheDir: cacheMode === 'off' ? null : options.cacheDir,
      cacheMode,
      budgetUsd: options.budgetUsd,
      stoppedByBudget: simulation.stoppedByBudget,
      startedAt,
      finishedAt: new Date().toISOString(),
    },
    metrics: computeMetrics(simulation, cache.stats),
    samples: simulation.samples,
    units: simulation.units,
    readings: simulation.readings,
  };
  const comparison = previous ? comparePaired(previous.units, report.units) : null;

  await mkdir(options.outDir, { recursive: true });
  const files = [join(options.outDir, REPORT_FILE), join(options.outDir, SUMMARY_FILE)];
  await writeFile(files[0]!, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(files[1]!, renderReportMarkdown(report, comparison), 'utf8');
  if (comparison) {
    const comparisonFile = join(options.outDir, COMPARISON_FILE);
    await writeFile(comparisonFile, `${JSON.stringify(comparison, null, 2)}\n`, 'utf8');
    files.push(comparisonFile);
  }
  return { report, comparison, files, cacheStats: cache.stats };
}
