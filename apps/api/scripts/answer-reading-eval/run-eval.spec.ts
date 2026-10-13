import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { DEFAULT_CONSENSUS_POLICY } from '@soe/types';
import { loadDataset, parseDatasetManifest } from './dataset';
import { FIXTURES_DIR, FIXTURES_MANIFEST, renderAnswerBox } from './generar-fixtures';
import { loadRouteSet } from './route-set';
import {
  COMPARISON_FILE,
  REPORT_FILE,
  SUMMARY_FILE,
  dryRunTranscribers,
  runEvalCommand,
  type EvalCommandOptions,
} from './run-eval';

const DEFAULT_ROUTE = join(__dirname, 'routes', 'default.json');
const ACTUAL_ROUTES = join(__dirname, 'routes', 'actual.json');
const PIPELINE_B_ROUTES = join(__dirname, 'routes', 'pipeline-b.json');

function decodedPng(png: Buffer): { header: string; pixels: Buffer } {
  let offset = 8;
  let header = '';
  const data: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') header = body.toString('hex');
    if (type === 'IDAT') data.push(body);
    offset += length + 12;
  }
  return { header, pixels: inflateSync(Buffer.concat(data)) };
}

describe('arnés answer-reading:eval', () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'answer-reading-eval-spec-'));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  function options(overrides: Partial<EvalCommandOptions> = {}): EvalCommandOptions {
    return {
      datasetDir: FIXTURES_DIR,
      routesFile: DEFAULT_ROUTE,
      repetitions: 2,
      concurrency: 2,
      outDir,
      dryRun: true,
      budgetUsd: null,
      compareFile: null,
      cacheDir: null,
      cacheMode: 'off',
      readerMinConfidence: null,
      ...overrides,
    };
  }

  it('la ruta por defecto usa Haiku 5.5 + Gemini 3.5 Flash-Lite, el prompt v2 y la política por defecto', async () => {
    const { routes } = await loadRouteSet(DEFAULT_ROUTE);
    expect(routes).toHaveLength(1);
    const [route] = routes;
    expect(route?.status).toBe('active');
    expect(route?.readers.map((reader) => reader.model)).toEqual([
      'claude-haiku-5-5',
      'gemini-3.5-flash-lite',
    ]);
    expect(route?.readers.every((reader) => reader.promptRef === 'transcribe.short-answer@2')).toBe(
      true,
    );
    expect(route?.policy).toEqual(DEFAULT_CONSENSUS_POLICY);
  });

  it('las rutas actual y pipeline B cubren los mismos formatos con las mismas políticas y prompts', async () => {
    const actual = await loadRouteSet(ACTUAL_ROUTES);
    const pipelineB = await loadRouteSet(PIPELINE_B_ROUTES);
    const shape = (routes: typeof actual.routes) =>
      routes.map((route) => ({
        level: route.level,
        formatKind: route.formatKind,
        policy: route.policy,
        prompts: route.readers.map((reader) => `${reader.promptRef}:${reader.hints}`),
      }));
    expect(shape(pipelineB.routes)).toEqual(shape(actual.routes));
    const models = new Set(pipelineB.routes.flatMap((route) => route.readers.map((r) => r.model)));
    expect([...models].sort()).toEqual(['gemini-3.5-flash', 'gpt-6-luna']);
    const luna = pipelineB.routes.flatMap((route) =>
      route.readers.filter((reader) => reader.model === 'gpt-6-luna'),
    );
    expect(luna.every((reader) => reader.params.reasoning === 'low')).toBe(true);
  });

  it('la ruta de escalamiento es la final más gpt-6.1-sol en las rutas que autoaceptan', async () => {
    const final = await loadRouteSet(join(__dirname, 'routes', 'pipeline-b-final.json'));
    const escalation = await loadRouteSet(
      join(__dirname, 'routes', 'pipeline-b-escalamiento.json'),
    );
    expect(escalation.routes).toHaveLength(final.routes.length);
    final.routes.forEach((route, index) => {
      const next = escalation.routes[index]!;
      if (!route.policy.autoAccept) {
        expect(next).toEqual(route);
        return;
      }
      const gemini = route.readers.find((reader) => reader.provider === 'gemini')!;
      expect(next).toEqual({
        ...route,
        id: next.id,
        version: route.version + 1,
        policy: {
          ...route.policy,
          onDisagreement: 'tiebreak_reader',
          tiebreakReader: {
            key: 'gpt-6.1-sol',
            transcriberId: 'llm',
            provider: 'openai',
            family: 'openai-sol',
            model: 'gpt-6.1-sol',
            promptRef: gemini.promptRef,
            hints: gemini.hints,
            params: {
              reasoning: 'low',
              timeoutMs: 90000,
              maxOutputTokens: 4096,
              mediaResolution: 'medium',
            },
            minConfidence: 0.9,
          },
          tiebreakOn: ['readers_disagree', 'low_confidence', 'reader_requested_review'],
          tiebreakAgreeWith: 'other_provider',
        },
      });
    });
  });

  it('los fixtures en disco coinciden con su generador y el manifiesto v1 sigue siendo válido', async () => {
    const onDisk: unknown = JSON.parse(await readFile(join(FIXTURES_DIR, 'manifest.json'), 'utf8'));
    expect(onDisk).toEqual(FIXTURES_MANIFEST);
    expect(parseDatasetManifest(onDisk).ok).toBe(true);
    for (const sample of FIXTURES_MANIFEST.samples) {
      const bytes = await readFile(join(FIXTURES_DIR, sample.image));
      const onDiskPng = decodedPng(bytes);
      const generatedPng = decodedPng(renderAnswerBox(sample.label.literal));
      expect(onDiskPng.header).toBe(generatedPng.header);
      expect(onDiskPng.pixels.equals(generatedPng.pixels)).toBe(true);
    }
    const dataset = await loadDataset(FIXTURES_DIR);
    expect(dataset.samples.every((sample) => sample.image?.mimeType === 'image/png')).toBe(true);
  });

  it('rechaza una verdad cuyo literal no normaliza a la canónica declarada', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'answer-reading-eval-truth-'));
    try {
      await writeFile(join(dir, 'a.png'), renderAnswerBox('12'));
      await writeFile(
        join(dir, 'manifest.json'),
        JSON.stringify({
          manifestVersion: 2,
          name: 'verdad-mala',
          datasetVersion: '1',
          samples: [
            {
              id: 'a',
              image: 'a.png',
              format: { kind: 'integer', maxChars: 3, allowNegative: false },
              label: { state: 'answered', literal: '12', canonical: 'n:13' },
            },
          ],
        }),
      );
      await expect(loadDataset(dir)).rejects.toThrow('Verdad inconsistente en a');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('--dry-run corre sin APIs, escribe el informe y omite los formatos que el prompt no cubre', async () => {
    const result = await runEvalCommand(options());
    const { metrics } = result.report;
    expect(result.report.meta.dryRun).toBe(true);
    expect(metrics.samples).toEqual({
      total: 6,
      evaluated: 5,
      skipped: { prompt_unsupported_format: 1 },
    });
    expect(metrics.short.units).toBe(10);
    expect(metrics.short.autoAccepted).toMatchObject({ count: 10, total: 10, rate: 1 });
    expect(metrics.short.autoAcceptedWrong.count).toBe(0);
    expect(metrics.readers.map((reader) => reader.short?.exact.rate)).toEqual([1, 1]);
    expect(metrics.cost.spentUsd).toBe(0);

    const written: unknown = JSON.parse(await readFile(join(outDir, REPORT_FILE), 'utf8'));
    expect(written).toEqual(JSON.parse(JSON.stringify(result.report)));
    const summary = await readFile(join(outDir, SUMMARY_FILE), 'utf8');
    expect(summary).toContain('Autoaceptadas equivocadas');
    expect(summary).toContain('perjudican al alumno');
    expect(summary).toContain('omitida (prompt_unsupported_format)');
  });

  it('--compare pareado contra la misma corrida no muestra cambios', async () => {
    await runEvalCommand(options());
    const previous = join(outDir, 'anterior.json');
    await copyFile(join(outDir, REPORT_FILE), previous);
    const result = await runEvalCommand(options({ compareFile: previous }));
    expect(result.comparison?.pairedUnits).toBe(10);
    expect(result.comparison?.changedUnits).toEqual([]);
    expect(result.comparison?.metrics[0]).toMatchObject({
      metric: 'Autoaceptadas',
      both: 10,
      mcnemar: { onlyBefore: 0, onlyAfter: 0, pValue: 1 },
    });
    expect(result.files).toContain(join(outDir, COMPARISON_FILE));
  });

  it('--compare rechaza un informe que no es v2', async () => {
    const previous = join(outDir, 'viejo.json');
    await writeFile(previous, JSON.stringify({ meta: {}, metrics: {}, samples: [] }));
    await expect(runEvalCommand(options({ compareFile: previous }))).rejects.toThrow(
      'no es un informe v2',
    );
  });

  it('sin --dry-run exige un transcriptor real', async () => {
    await expect(runEvalCommand(options({ dryRun: false }))).rejects.toThrow('transcriptor real');
  });

  it('si faltan lecturas en el caché exige --budget-usd y no gasta por sobre el tope', async () => {
    const dataset = await loadDataset(FIXTURES_DIR);
    const fake = dryRunTranscribers(dataset);
    const cacheDir = await mkdtemp(join(tmpdir(), 'answer-reading-eval-cache-'));
    try {
      const real = options({ dryRun: false, cacheDir, cacheMode: 'use', repetitions: 1 });
      await expect(runEvalCommand(real, { transcriberFor: fake })).rejects.toThrow('--budget-usd');
      await expect(
        runEvalCommand(
          { ...real, budgetUsd: 0.005 },
          { transcriberFor: fake, estimateCallUsd: () => 0.001 },
        ),
      ).rejects.toThrow('sobre el tope');
      const first = await runEvalCommand(
        { ...real, budgetUsd: 1 },
        { transcriberFor: fake, estimateCallUsd: () => 0.001 },
      );
      expect(first.cacheStats.writes).toBe(10);
      const second = await runEvalCommand(real, { transcriberFor: () => null });
      expect(second.cacheStats).toEqual({ hits: 10, misses: 0, writes: 0 });
      expect(second.report.metrics.short.autoAccepted.count).toBe(5);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it('las lecturas de desempate son condicionales: no bloquean el tope previo, pero exigen --budget-usd', async () => {
    const { routes } = await loadRouteSet(DEFAULT_ROUTE);
    const [route] = routes;
    if (!route) throw new Error('Sin ruta por defecto');
    const [firstReader] = route.readers;
    if (!firstReader) throw new Error('Sin lector');
    const withTiebreak = {
      ...route,
      policy: {
        ...route.policy,
        onDisagreement: 'tiebreak_reader',
        tiebreakReader: {
          ...firstReader,
          key: 'desempate',
          model: 'gpt-6.1-sol',
          provider: 'openai',
        },
        tiebreakOn: ['readers_disagree', 'low_confidence', 'reader_requested_review'],
        tiebreakAgreeWith: 'other_provider',
      },
    };
    const routesFile = join(outDir, 'rutas-desempate.json');
    await writeFile(
      routesFile,
      JSON.stringify({ description: 'desempate', routes: [withTiebreak] }),
    );
    const dataset = await loadDataset(FIXTURES_DIR);
    const fake = dryRunTranscribers(dataset);
    const cacheDir = await mkdtemp(join(tmpdir(), 'answer-reading-eval-cache-'));
    try {
      const real = options({
        dryRun: false,
        cacheDir,
        cacheMode: 'use',
        repetitions: 1,
        routesFile,
      });
      await expect(runEvalCommand(real, { transcriberFor: fake })).rejects.toThrow('--budget-usd');
      const result = await runEvalCommand(
        { ...real, budgetUsd: 0.012 },
        { transcriberFor: fake, estimateCallUsd: () => 0.001 },
      );
      expect(result.cacheStats.writes).toBe(10);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
