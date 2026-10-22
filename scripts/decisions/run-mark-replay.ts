/**
 * Replay de la desambiguación de marcas contra la PoC (gate de §4.4 de
 * docs/diseno-desambiguacion-marcas-ia.md).
 *
 *   packages/db/node_modules/.bin/tsx --tsconfig scripts/decisions/tsconfig.json \
 *     scripts/decisions/run-mark-replay.ts [--poc <carpeta>] [--limit N] [--concurrency N] \
 *     [--engine jev|openai|both] [--out ruta.json]
 *
 * Corre los recortes de la PoC (`sample-100.json`, campo `truth`) con el builder de
 * producción (`buildMarkDisambiguationDecision`) y los adaptadores reales
 * (`JevDecisionEngine` con imágenes experimentales y `OpenAiDecisionEngine`), cada uno
 * con su modelo fijado, la imagen ORIGINAL (el reescalado es del adaptador) y simula
 * `pairConsensus` con los umbrales provisorios de §7.2 y el veto de dominio.
 *
 * Criterio: ningún error nuevo respecto de la PoC y la simulación dentro de ±3
 * automáticas de la referencia (93/100 y 33/35 dudosas, 0 errores).
 *
 * Necesita `OPENAI_API_KEY` y `TYPESAFE_API_KEY` (entorno o `repositorio/.env`). Costo
 * esperado: < US$0,02 por corrida completa. No toca ninguna BDD.
 *
 * Salida: JSON crudo en `scripts/decisions/data/mark-replay-<fecha>.json` (gitignoreado)
 * y un resumen por consola.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import {
  DecisionError,
  JevDecisionEngine,
  OpenAiDecisionEngine,
  pairConsensus,
  type DecisionEngine,
  type PairSide,
  type PairThresholds,
} from '../../packages/decisions/src/index';
import {
  buildMarkDisambiguationDecision,
  markDisambiguationChoiceKeys,
  MARK_ANSWER_BLANK,
  MARK_DISAMBIGUATION_DECISION_VERSION,
} from '../../apps/api/src/sheet-scanning/mark-disambiguation-decision';
import { loadEnv, REPO_ROOT } from './env';

const JEV_MODEL = 'jev-1.14.0';
const OPENAI_MODEL = 'gpt-6-luna';
const TIMEOUT_MS = 15_000;

/** Umbrales PROVISORIOS de §7.2. */
const PROVISIONAL: { jev: PairThresholds; openai: PairThresholds } = {
  jev: { agree: 0.6, solo: 0.85, unsure: 0.5 },
  openai: { agree: 0.5, solo: 0.8, unsure: 0.5 },
};

/** Referencia de §1.1 (simulación sobre los resultados guardados de la PoC). */
const REFERENCE = { autoAll: 93, autoDoubtful: 33, doubtful: 35 };
const TOLERANCE = 3;

interface SampleRow {
  id: string;
  truth: string;
  omr_state: string;
  stratum: string;
  options: string[];
  crop: string;
}

interface PocRow {
  id: string;
  choice?: string;
  confidence?: number;
  error?: string;
}

interface EngineRun {
  choice: string | null;
  confidence: number | null;
  probabilities: Record<string, number> | null;
  errorCode: string | null;
  errorMessage: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  model: string | null;
}

interface ReplayRow {
  id: string;
  truth: string;
  omrState: string;
  stratum: string;
  jev: EngineRun | null;
  openai: EngineRun | null;
}

interface CliOptions {
  poc: string;
  limit: number | null;
  concurrency: number;
  engine: 'jev' | 'openai' | 'both';
  out: string | null;
  reuse: string | null;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    poc: resolve(REPO_ROOT, '..', 'analisis-omr-marcas', 'poc-decisions-2026-10-21'),
    limit: null,
    concurrency: 4,
    engine: 'both',
    out: null,
    reuse: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--poc' && value) options.poc = resolve(value);
    else if (flag === '--limit' && value) options.limit = Number(value);
    else if (flag === '--concurrency' && value) options.concurrency = Number(value);
    else if (flag === '--engine' && (value === 'jev' || value === 'openai' || value === 'both'))
      options.engine = value;
    else if (flag === '--out' && value) options.out = resolve(value);
    else if (flag === '--reuse' && value) options.reuse = resolve(value);
    else continue;
    i++;
  }
  return options;
}

function cropPath(poc: string, crop: string): string {
  return resolve(poc, 'crops', crop);
}

function readJsonl(path: string): Map<string, PocRow> {
  const rows = new Map<string, PocRow>();
  if (!existsSync(path)) return rows;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as PocRow;
    rows.set(row.id, row);
  }
  return rows;
}

async function runEngine(
  engine: DecisionEngine,
  model: string,
  row: SampleRow,
  base64: string,
): Promise<EngineRun> {
  const decision = buildMarkDisambiguationDecision(row.options);
  try {
    const result = await engine.evaluate({
      state: decision.state,
      questions: decision.questions,
      images: [{ mimeType: 'image/jpeg', data: base64 }],
      model,
      timeoutMs: TIMEOUT_MS,
    });
    const answer = result.answers.respuesta;
    return {
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities: { ...answer.probabilities },
      errorCode: null,
      errorMessage: null,
      latencyMs: Math.round(result.latencyMs),
      inputTokens: result.usage.inputTokens,
      model: result.model,
    };
  } catch (error) {
    const code = error instanceof DecisionError ? error.code : 'upstream';
    return {
      choice: null,
      confidence: null,
      probabilities: null,
      errorCode: code,
      errorMessage: error instanceof Error ? error.message.slice(0, 300) : String(error),
      latencyMs: null,
      inputTokens: null,
      model: null,
    };
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

function toSide(
  run:
    | {
        choice?: string | null;
        confidence?: number | null;
        error?: string | null;
        errorCode?: string | null;
      }
    | null
    | undefined,
): PairSide {
  if (!run || run.choice == null || run.confidence == null) {
    return { status: 'failed', code: 'upstream' };
  }
  return {
    status: 'ok',
    answer: { type: 'choice', choice: run.choice, confidence: run.confidence, probabilities: {} },
  };
}

interface Simulation {
  autoAll: number;
  errorsAll: number;
  autoDoubtful: number;
  errorsDoubtful: number;
  doubtful: number;
  verdicts: Record<string, number>;
  errors: string[];
  review: string[];
}

function simulate(
  rows: readonly {
    id: string;
    truth: string;
    omrState: string;
    stratum: string;
    options: string[];
    a: PairSide;
    b: PairSide;
  }[],
): Simulation {
  const sim: Simulation = {
    autoAll: 0,
    errorsAll: 0,
    autoDoubtful: 0,
    errorsDoubtful: 0,
    doubtful: 0,
    verdicts: {},
    errors: [],
    review: [],
  };
  for (const row of rows) {
    const doubtful = row.stratum.startsWith('omr-dudosa');
    if (doubtful) sim.doubtful++;
    const consensus = pairConsensus(
      row.a,
      row.b,
      PROVISIONAL.jev,
      PROVISIONAL.openai,
      markDisambiguationChoiceKeys(row.options),
    );
    const vetoed =
      consensus.route === 'auto' &&
      row.omrState === 'multiple' &&
      consensus.choice === MARK_ANSWER_BLANK;
    const verdict = vetoed ? 'vetoed' : consensus.verdict;
    sim.verdicts[verdict] = (sim.verdicts[verdict] ?? 0) + 1;
    if (consensus.route !== 'auto' || vetoed) {
      sim.review.push(`${row.id} (${verdict})`);
      continue;
    }
    sim.autoAll++;
    if (doubtful) sim.autoDoubtful++;
    if (consensus.choice !== row.truth) {
      sim.errorsAll++;
      if (doubtful) sim.errorsDoubtful++;
      sim.errors.push(`${row.id}: verdad=${row.truth} ia=${String(consensus.choice)} (${verdict})`);
    }
  }
  return sim;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? null;
}

function engineSummary(
  name: string,
  rows: ReplayRow[],
  pick: (r: ReplayRow) => EngineRun | null,
  poc: Map<string, PocRow>,
  thresholds: PairThresholds,
) {
  const runs = rows.map((r) => ({ row: r, run: pick(r) })).filter((x) => x.run !== null);
  const correct = runs.filter((x) => x.run?.choice === x.row.truth).length;
  const failed = runs.filter((x) => x.run?.errorCode !== null);
  const newErrors = runs
    .filter((x) => x.run?.choice !== x.row.truth && poc.get(x.row.id)?.choice === x.row.truth)
    .map(
      (x) =>
        `${x.row.id}: verdad=${x.row.truth} dijo=${String(x.run?.choice)} conf=${String(x.run?.confidence)} ${x.run?.errorCode ?? ''}`,
    );
  const confidentNewErrors = runs
    .filter(
      (x) =>
        x.run?.choice !== x.row.truth &&
        poc.get(x.row.id)?.choice === x.row.truth &&
        (x.run?.confidence ?? 0) >= thresholds.unsure,
    )
    .map(
      (x) =>
        `${x.row.id}: verdad=${x.row.truth} dijo=${String(x.run?.choice)} conf=${String(x.run?.confidence)}`,
    );
  const latencies = runs.flatMap((x) => (x.run?.latencyMs == null ? [] : [x.run.latencyMs]));
  const tokens = runs.flatMap((x) => (x.run?.inputTokens == null ? [] : [x.run.inputTokens]));
  const correctConf = runs
    .filter((x) => x.run?.choice === x.row.truth)
    .flatMap((x) => (x.run?.confidence == null ? [] : [x.run.confidence]));
  const pocCorrect = rows.filter((r) => poc.get(r.id)?.choice === r.truth).length;
  return {
    name,
    evaluated: runs.length,
    correct,
    failed: failed.length,
    failures: failed.map((x) => `${x.row.id}: ${x.run?.errorCode} ${x.run?.errorMessage ?? ''}`),
    pocCorrect,
    newErrors,
    confidentNewErrors,
    wrong: runs
      .filter((x) => x.run?.choice !== x.row.truth)
      .map(
        (x) =>
          `${x.row.id}: verdad=${x.row.truth} dijo=${String(x.run?.choice)} conf=${String(x.run?.confidence)}`,
      ),
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    inputTokensP50: percentile(tokens, 50),
    correctConfidenceMin: correctConf.length ? Math.min(...correctConf) : null,
    correctConfidenceP10: percentile(correctConf, 10),
  };
}

async function main(): Promise<void> {
  loadEnv();
  const cli = parseArgs(process.argv.slice(2));
  const sample = JSON.parse(
    readFileSync(resolve(cli.poc, 'sample-100.json'), 'utf8'),
  ) as SampleRow[];
  const rows = cli.limit ? sample.slice(0, cli.limit) : sample;
  const pocJev = readJsonl(resolve(cli.poc, 'results', 'jev-x.jsonl'));
  const pocOpenai = readJsonl(resolve(cli.poc, 'results', 'openai-orig.jsonl'));

  const jev = new JevDecisionEngine({ experimentalImages: true, defaultModel: JEV_MODEL });
  const openai = new OpenAiDecisionEngine();
  if (cli.engine !== 'openai' && !jev.isAvailable()) throw new Error('Falta TYPESAFE_API_KEY');
  if (cli.engine !== 'jev' && !openai.isAvailable()) throw new Error('Falta OPENAI_API_KEY');

  const previous = cli.reuse
    ? new Map(
        (JSON.parse(readFileSync(cli.reuse, 'utf8')) as { rows: ReplayRow[] }).rows.map((r) => [
          r.id,
          r,
        ]),
      )
    : new Map<string, ReplayRow>();

  console.log(
    `Replay ${MARK_DISAMBIGUATION_DECISION_VERSION}: ${rows.length} recortes, motores=${cli.engine}`,
  );
  const replay = await mapWithConcurrency(
    rows,
    cli.concurrency,
    async (row): Promise<ReplayRow> => {
      const base64 = readFileSync(cropPath(cli.poc, row.crop)).toString('base64');
      const prior = previous.get(row.id);
      const [jevRun, openaiRun] = await Promise.all([
        cli.engine === 'openai'
          ? Promise.resolve(prior?.jev ?? null)
          : runEngine(jev, JEV_MODEL, row, base64),
        cli.engine === 'jev'
          ? Promise.resolve(prior?.openai ?? null)
          : runEngine(openai, OPENAI_MODEL, row, base64),
      ]);
      return {
        id: row.id,
        truth: row.truth,
        omrState: row.omr_state,
        stratum: row.stratum,
        jev: jevRun,
        openai: openaiRun,
      };
    },
  );

  const byId = new Map(rows.map((r) => [r.id, r]));
  const simReplay = simulate(
    replay.map((r) => ({
      id: r.id,
      truth: r.truth,
      omrState: r.omrState,
      stratum: r.stratum,
      options: byId.get(r.id)?.options ?? [],
      a: toSide(r.jev),
      b: toSide(r.openai),
    })),
  );
  const simPoc = simulate(
    rows.map((r) => ({
      id: r.id,
      truth: r.truth,
      omrState: r.omr_state,
      stratum: r.stratum,
      options: r.options,
      a: toSide(pocJev.get(r.id)),
      b: toSide(pocOpenai.get(r.id)),
    })),
  );

  const summary = {
    version: MARK_DISAMBIGUATION_DECISION_VERSION,
    models: { jev: JEV_MODEL, openai: OPENAI_MODEL },
    thresholds: PROVISIONAL,
    jev: engineSummary('jev', replay, (r) => r.jev, pocJev, PROVISIONAL.jev),
    openai: engineSummary('openai', replay, (r) => r.openai, pocOpenai, PROVISIONAL.openai),
    simulationReplay: simReplay,
    simulationPoc: simPoc,
  };
  const newErrors = summary.jev.newErrors.length + summary.openai.newErrors.length;
  const confidentNewErrors =
    summary.jev.confidentNewErrors.length + summary.openai.confidentNewErrors.length;
  const full = rows.length === sample.length;
  const passes =
    confidentNewErrors === 0 &&
    simReplay.errorsAll === 0 &&
    (!full ||
      (Math.abs(simReplay.autoAll - REFERENCE.autoAll) <= TOLERANCE &&
        Math.abs(simReplay.autoDoubtful - REFERENCE.autoDoubtful) <= TOLERANCE));

  const out =
    cli.out ??
    resolve(
      REPO_ROOT,
      'scripts',
      'decisions',
      'data',
      `mark-replay-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`,
    );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ summary, rows: replay }, null, 2));

  for (const engine of [summary.jev, summary.openai]) {
    console.log(
      `\n${engine.name}: ${engine.correct}/${engine.evaluated} correctas (PoC: ${engine.pocCorrect}), ${engine.failed} fallas, ` +
        `p50 ${engine.latencyP50} ms, p95 ${engine.latencyP95} ms, tokens p50 ${engine.inputTokensP50}, ` +
        `conf correctas min ${engine.correctConfidenceMin} p10 ${engine.correctConfidenceP10}`,
    );
    for (const line of engine.wrong) console.log(`  erró   ${line}`);
    for (const line of engine.newErrors) console.log(`  nuevo  ${line}`);
    for (const line of engine.confidentNewErrors)
      console.log(`  NUEVO CON CONFIANZA >= unsure  ${line}`);
    for (const line of engine.failures) console.log(`  falla  ${line}`);
  }
  for (const [label, sim] of [
    ['replay', simReplay],
    ['PoC guardada', simPoc],
  ] as const) {
    console.log(
      `\nSimulación (${label}): ${sim.autoAll}/${rows.length} automáticas, ${sim.errorsAll} errores; ` +
        `dudosas ${sim.autoDoubtful}/${sim.doubtful} automáticas, ${sim.errorsDoubtful} errores. Veredictos: ${JSON.stringify(sim.verdicts)}`,
    );
    for (const line of sim.errors) console.log(`  ERROR  ${line}`);
    for (const line of sim.review) console.log(`  revisión ${line}`);
  }
  console.log(
    `\nCriterio §4.4: ${passes ? 'CUMPLE' : 'NO CUMPLE'} (errores nuevos por motor: ${newErrors}; ` +
      `con confianza >= unsure: ${confidentNewErrors}; errores automáticos: ${simReplay.errorsAll}). JSON: ${out}`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
