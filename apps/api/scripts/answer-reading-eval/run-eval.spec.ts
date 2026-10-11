import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONSENSUS_POLICY } from '@soe/types';
import { FIXTURES_DIR, FIXTURES_MANIFEST, renderAnswerBox } from './generar-fixtures';
import {
  COMPARISON_FILE,
  REPORT_FILE,
  SUMMARY_FILE,
  loadDataset,
  loadRoute,
  runEvalCommand,
  type EvalCommandOptions,
} from './run-eval';

const DEFAULT_ROUTE = join(__dirname, 'routes', 'default.json');

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
      routeFile: DEFAULT_ROUTE,
      repetitions: 2,
      concurrency: 2,
      outDir,
      dryRun: true,
      budgetUsd: null,
      compareFile: null,
      ...overrides,
    };
  }

  it('la ruta por defecto usa Haiku 5.5 + Gemini 3.5 Flash-Lite, el prompt v2 y la política por defecto', async () => {
    const route = await loadRoute(DEFAULT_ROUTE);
    expect(route.readers.map((reader) => reader.model)).toEqual([
      'claude-haiku-5-5',
      'gemini-3.5-flash-lite',
    ]);
    expect(route.readers.every((reader) => reader.promptRef === 'transcribe.short-answer@2')).toBe(
      true,
    );
    expect(route.policy).toEqual(DEFAULT_CONSENSUS_POLICY);
  });

  it('los fixtures en disco coinciden con su generador', async () => {
    const onDisk: unknown = JSON.parse(await readFile(join(FIXTURES_DIR, 'manifest.json'), 'utf8'));
    expect(onDisk).toEqual(FIXTURES_MANIFEST);
    for (const sample of FIXTURES_MANIFEST.samples) {
      const bytes = await readFile(join(FIXTURES_DIR, sample.image));
      expect(bytes.equals(renderAnswerBox(sample.label.literal))).toBe(true);
    }
    const dataset = await loadDataset(FIXTURES_DIR);
    expect(dataset.inputs.every((input) => input.image?.mimeType === 'image/png')).toBe(true);
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
    expect(metrics.decisions).toBe(10);
    expect(metrics.autoAcceptedPrecision.rate).toBe(1);
    expect(metrics.autoAccepted.rate).toBe(1);
    expect(metrics.grading?.accuracy).toEqual({ count: 4, total: 4, rate: 1 });
    expect(metrics.readers.map((reader) => reader.accuracy.rate)).toEqual([1, 1]);
    expect(metrics.cost.totalUsd).toBe(0);

    const written: unknown = JSON.parse(await readFile(join(outDir, REPORT_FILE), 'utf8'));
    expect(written).toEqual(JSON.parse(JSON.stringify(result.report)));
    const summary = await readFile(join(outDir, SUMMARY_FILE), 'utf8');
    expect(summary).toContain('Precisión de lo autoaceptado');
    expect(summary).toContain('omitida (prompt_unsupported_format)');
  });

  it('--compare contra la misma ruta no muestra cambios', async () => {
    await runEvalCommand(options());
    const previous = join(outDir, 'anterior.json');
    await copyFile(join(outDir, REPORT_FILE), previous);
    const result = await runEvalCommand(options({ compareFile: previous }));
    expect(result.comparison?.changedSamples).toEqual([]);
    expect(
      result.comparison?.deltas.find((delta) => delta.metric === 'Precisión de lo autoaceptado'),
    ).toMatchObject({ delta: 0 });
    expect(result.files).toContain(join(outDir, COMPARISON_FILE));
  });

  it('sin --dry-run exige un transcriptor real', async () => {
    await expect(runEvalCommand(options({ dryRun: false }))).rejects.toThrow('transcriptor real');
  });
});
