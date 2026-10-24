import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  isTranscriptionPromptFor,
  normalizeTranscription,
  renderTranscriptionPrompt,
  type TranscriptionResult,
} from '@soe/answer-reading';
import { readerSpecSchema, type TranscriptionStatus } from '@soe/types';
import { loadDataset, type PreparedSample } from './dataset';
import {
  ReadingCache,
  cachedReadingEntry,
  canonicalJson,
  readingCacheKey,
  type CachedReading,
  type ReadingCacheKeyInput,
} from './reading-cache';
import { loadRouteSet } from './route-set';
import { planReadings, planSamples } from './simulate';

export interface ExperimentReading {
  readonly key: string;
  readonly medicion?: string;
  readonly candidate: string;
  readonly rep: number;
  readonly crop: string;
  readonly formatKind: string;
  readonly reader: unknown;
  readonly promptRef: string;
  readonly promptHash?: string;
  readonly prompt?: { readonly system: string; readonly user: string };
  readonly status: string;
  readonly errorCode: string | null;
  readonly providerModel: string | null;
  readonly output: unknown;
  readonly rawText: string | null;
  readonly normalized: unknown;
  readonly usage: TranscriptionResult['usage'];
  readonly costUsd: number | null;
  readonly latencyMs: number;
}

export type ImportVerdict =
  | {
      readonly kind: 'import';
      readonly entry: CachedReading;
      readonly normalizationChanged: boolean;
    }
  | { readonly kind: 'skip'; readonly reason: string };

export interface ImportContext {
  readonly sampleByImageSha: ReadonlyMap<string, PreparedSample>;
  readonly imageShaOf: (reading: ExperimentReading) => Promise<string | null>;
  readonly source: string;
  readonly force: boolean;
}

const UNCHECKED_PROMPT =
  'sin el prompt ni su hash guardados (usa --force para importar sin ese control)';
const PROMPT_CHANGED = 'el prompt renderizado cambió desde el experimento';

const SOURCE_IMAGE_DIR_BY_MEDICION: Readonly<Record<string, string>> = {
  'numero-tapado': 'sin-numero',
};

export async function verdictFor(
  reading: ExperimentReading,
  context: ImportContext,
): Promise<ImportVerdict> {
  const skip = (reason: string): ImportVerdict => ({ kind: 'skip', reason });
  if (reading.medicion === 'arbitro') return skip('árbitro: no es una transcripción');
  if (reading.medicion === 'por-casilla')
    return skip('recorte por casilla: otra imagen y otro formato');
  if (reading.status !== 'ok' || reading.output === null) return skip(`estado ${reading.status}`);
  const imageSha = await context.imageShaOf(reading);
  if (imageSha === null) return skip('imagen de origen no encontrada');
  const prepared = context.sampleByImageSha.get(imageSha);
  if (!prepared) return skip(`imagen ${reading.medicion ?? 'original'} que no está en el dataset`);
  const { format } = prepared.sample;
  if (reading.formatKind !== format.kind) return skip('formato distinto del de la muestra');
  const reader = readerSpecSchema.safeParse(reading.reader);
  if (!reader.success) return skip('lector inválido');
  if (reader.data.promptRef !== reading.promptRef) return skip('promptRef distinto del lector');
  if (!isTranscriptionPromptFor(reader.data.promptRef, format.kind)) {
    return skip('el prompt no atiende el formato');
  }
  const rendered = renderTranscriptionPrompt(reader.data, format, {
    gradeName: prepared.sample.gradeName ?? null,
  });
  const promptCheck = promptCheckOf(reading, rendered.prompt);
  if (promptCheck === 'changed') return skip(PROMPT_CHANGED);
  if (promptCheck === 'unchecked' && !context.force) return skip(UNCHECKED_PROMPT);
  const output = rendered.outputZodSchema.safeParse(reading.output);
  if (!output.success) return skip('la salida no valida contra el esquema del formato');
  const keyInput: ReadingCacheKeyInput = {
    reader: reader.data,
    prompt: rendered.prompt,
    outputJsonSchema: rendered.outputSchema,
    imageSha256: imageSha,
    repetition: reading.rep,
  };
  const key = readingCacheKey(keyInput);
  return {
    kind: 'import',
    entry: cachedReadingEntry(
      key,
      keyInput,
      rendered.prompt,
      transcriptionResult(reading),
      context.source,
    ),
    normalizationChanged:
      canonicalJson(normalizeTranscription(output.data, format)) !==
      canonicalJson(reading.normalized),
  };
}

function promptCheckOf(
  reading: ExperimentReading,
  rendered: { readonly hash: string; readonly system: string; readonly user: string },
): 'same' | 'changed' | 'unchecked' {
  if (reading.promptHash !== undefined) {
    return reading.promptHash === rendered.hash ? 'same' : 'changed';
  }
  if (reading.prompt !== undefined) {
    const same = reading.prompt.system === rendered.system && reading.prompt.user === rendered.user;
    return same ? 'same' : 'changed';
  }
  return 'unchecked';
}

function transcriptionResult(reading: ExperimentReading): TranscriptionResult {
  return {
    status: reading.status as TranscriptionStatus,
    output: reading.output as TranscriptionResult['output'],
    rawText: reading.rawText,
    providerModel: reading.providerModel ?? '',
    usage: reading.usage,
    costUsd: reading.costUsd,
    latencyMs: reading.latencyMs,
    errorCode: reading.errorCode,
  };
}

function valuesOf(argv: readonly string[], name: string): string[] {
  const values: string[] = [];
  argv.forEach((arg, index) => {
    const value = argv[index + 1];
    if (arg === name && value !== undefined) values.push(value);
  });
  return values;
}

async function sha256Of(path: string): Promise<string | null> {
  try {
    return createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [datasetDir] = valuesOf(argv, '--dataset');
  const [cacheDir] = valuesOf(argv, '--cache-dir');
  const files = valuesOf(argv, '--lecturas');
  const routeFiles = valuesOf(argv, '--routes');
  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force');
  if (!datasetDir || !cacheDir || files.length === 0) {
    throw new Error(
      'Uso: importar-lecturas.ts --dataset <dir> --cache-dir <dir> --lecturas <lecturas.json>... [--routes <rutas.json>...] [--dry-run] [--force]',
    );
  }
  const dataset = await loadDataset(datasetDir);
  const sampleByImageSha = new Map<string, PreparedSample>();
  for (const prepared of dataset.samples) {
    if (prepared.image) sampleByImageSha.set(prepared.image.sha256, prepared);
  }
  const cache = new ReadingCache(resolve(cacheDir), 'use');
  const imported = new Set<string>();
  for (const file of files) {
    const experimentDir = dirname(resolve(file));
    const { lecturas } = JSON.parse(await readFile(resolve(file), 'utf8')) as {
      lecturas: ExperimentReading[];
    };
    const shaCache = new Map<string, string | null>();
    const imageShaOf = async (reading: ExperimentReading) => {
      const folder = reading.medicion ? SOURCE_IMAGE_DIR_BY_MEDICION[reading.medicion] : undefined;
      const path = folder
        ? join(experimentDir, folder, basename(reading.crop))
        : join(dataset.dir, basename(reading.crop));
      if (!shaCache.has(path)) shaCache.set(path, await sha256Of(path));
      return shaCache.get(path) ?? null;
    };
    const source = `import:${basename(experimentDir)}`;
    const skipped = new Map<string, number>();
    let written = 0;
    let alreadyCached = 0;
    let normalizationChanged = 0;
    for (const reading of lecturas) {
      const verdict = await verdictFor(reading, { sampleByImageSha, imageShaOf, source, force });
      if (verdict.kind === 'skip') {
        skipped.set(verdict.reason, (skipped.get(verdict.reason) ?? 0) + 1);
        continue;
      }
      imported.add(verdict.entry.key);
      if (verdict.normalizationChanged) normalizationChanged += 1;
      if (await cache.has(verdict.entry.key)) {
        alreadyCached += 1;
        continue;
      }
      if (dryRun) continue;
      await cache.put(verdict.entry);
      written += 1;
    }
    process.stdout.write(
      `${file}\n  lecturas: ${lecturas.length}; importables: ${lecturas.length - [...skipped.values()].reduce((a, b) => a + b, 0)} (escritas ${written}, ya en caché ${alreadyCached}); normalización distinta a la guardada: ${normalizationChanged}\n`,
    );
    for (const [reason, count] of skipped)
      process.stdout.write(`  omitidas (${reason}): ${count}\n`);
  }
  for (const routeFile of routeFiles) {
    const routeSet = await loadRouteSet(routeFile);
    const planned = planReadings(planSamples(dataset.samples, routeSet), 3);
    const covered = planned.filter((reading) => imported.has(reading.cacheKey)).length;
    process.stdout.write(
      `${routeFile}: ${covered}/${planned.length} lecturas de 3 repeticiones cubiertas por lo importado\n`,
    );
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
