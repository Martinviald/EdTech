/**
 * Calibración de la desambiguación de marcas con IA desde la BDD LOCAL (§7.3 de
 * docs/diseno-desambiguacion-marcas-ia.md).
 *
 *   packages/db/node_modules/.bin/tsx --tsconfig scripts/decisions/tsconfig.json \
 *     scripts/decisions/run-mark-calibration.ts [--org <uuid>] [--step 0.05] [--max-errors 1] [--out ruta.md]
 *
 * - SOLO lectura: todo corre en una transacción `read only`. Se niega a correr si la
 *   URL no apunta a localhost (nunca demo ni AWS ni una copia remota).
 * - Une `decision_calls` (features `mark_disambiguation_jev` y `mark_disambiguation_openai`,
 *   por `correlation_id = sheet_scan_marks.id`) con `sheet_scan_marks`.
 * - Verdad humana: `reviewToMarkAnswer(review_decision, reviewed_value)` con `reviewed_by_id`
 *   no nulo. Verdad débil, aparte: auto-anuladas por el OMR sin IA aplicada.
 * - Simula `pairConsensus` (más el veto OMR `multiple` + IA `blank`) con los umbrales
 *   provisorios y sobre una grilla por motor; reporta la mejor combinación por cobertura con
 *   a lo más `--max-errors` errores.
 *
 * Salida (gitignoreada): scripts/decisions/data/mark-calibration-<fecha>.{md,json}
 */
import { mkdirSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';
import { MARK_ANSWER_NULL, reviewToMarkAnswer, type MarkReviewDecision } from '@soe/types';
import { loadEnv, maskUrl, REPO_ROOT } from './env';
import { pct } from './calibration-metrics';
import {
  assertSameAsPairConsensus,
  engineHealth,
  evaluate,
  PROVISIONAL_JEV,
  PROVISIONAL_OPENAI,
  searchBestThresholds,
  sliceReports,
  thresholdGrid,
  weakTruthReport,
  type EngineCall,
  type EngineKey,
  type Evaluation,
  type MarkCase,
  type SliceReport,
  type ThresholdPair,
} from './mark-calibration-metrics';

type Row = Record<string, unknown>;
interface PgTx {
  unsafe(query: string, params?: unknown[]): Promise<Row[]>;
}
interface PgSql {
  begin<T>(options: string, fn: (tx: PgTx) => Promise<T>): Promise<T>;
  end(options?: { timeout?: number }): Promise<void>;
}
type PostgresFactory = (url: string, options: Record<string, unknown>) => PgSql;

function loadPostgres(): PostgresFactory {
  const req = createRequire(resolve(REPO_ROOT, 'packages', 'db', 'package.json'));
  const mod: unknown = req('postgres');
  const factory =
    typeof mod === 'function'
      ? mod
      : typeof mod === 'object' && mod !== null && 'default' in mod
        ? (mod as { default: unknown }).default
        : null;
  if (typeof factory !== 'function') throw new Error('No se pudo cargar el cliente `postgres`');
  return factory as PostgresFactory;
}

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}
const ORG_ID = flag('org');
const STEP = Number(flag('step') ?? '0.05');
const MAX_ERRORS = Number(flag('max-errors') ?? '1');
const OUT_PATH = flag('out');

const FEATURE_BY_ENGINE: Record<EngineKey, string> = {
  jev: 'mark_disambiguation_jev',
  openai: 'mark_disambiguation_openai',
};
const QUESTION_ID = 'respuesta';

const MARKS_SQL = `
  SELECT m.id::text AS id, m.state::text AS state, m.doubt_reason, m.margin::float8 AS margin,
         m.auto_resolved, m.reviewed_by_id IS NOT NULL AS human, m.review_decision::text AS review_decision,
         m.reviewed_value, m.ai_resolution->>'applied' AS ai_applied,
         b.capture_profile->>'source' AS capture_source
  FROM sheet_scan_marks m
  JOIN sheet_scans s ON s.id = m.scan_id
  JOIN sheet_scan_batches b ON b.id = s.batch_id
  WHERE s.state <> 'superseded'
    AND EXISTS (
      SELECT 1 FROM decision_calls c
      WHERE c.correlation_id = m.id::text AND c.feature = ANY($1)
    )
`;

const CALLS_SQL = `
  SELECT c.correlation_id, c.feature, c.status::text AS status, c.error_code,
         c.answers->'${QUESTION_ID}' AS answer, c.latency_ms
  FROM decision_calls c
  WHERE c.feature = ANY($1) AND c.correlation_id IS NOT NULL
  ORDER BY c.created_at ASC
`;

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function toEngineCall(row: Row): EngineCall {
  const answer = row.answer as
    | { choice?: unknown; confidence?: unknown; probabilities?: unknown }
    | null
    | undefined;
  const probabilities =
    answer && typeof answer.probabilities === 'object' && answer.probabilities !== null
      ? Object.keys(answer.probabilities)
      : [];
  return {
    status: row.status === 'ok' ? 'ok' : 'error',
    errorCode: asString(row.error_code),
    choice: answer ? asString(answer.choice) : null,
    confidence: answer ? asNumber(answer.confidence) : null,
    optionKeys: probabilities,
    latencyMs: asNumber(row.latency_ms),
  };
}

function truthOf(row: Row): { truth: string; kind: 'human' | 'weak' } | null {
  const decision = asString(row.review_decision) as MarkReviewDecision | null;
  if (row.human === true) {
    const truth = reviewToMarkAnswer(decision, asString(row.reviewed_value));
    return truth === null ? null : { truth, kind: 'human' };
  }
  const autoAnnulledByOmr =
    row.auto_resolved === true && decision === 'annulled' && row.ai_applied !== 'true';
  return autoAnnulledByOmr ? { truth: MARK_ANSWER_NULL, kind: 'weak' } : null;
}

function buildCases(markRows: Row[], callRows: Row[]): { cases: MarkCase[]; unlabeled: number } {
  const latestByMarkAndEngine = new Map<string, EngineCall>();
  const engineByFeature = new Map<string, EngineKey>([
    [FEATURE_BY_ENGINE.jev, 'jev'],
    [FEATURE_BY_ENGINE.openai, 'openai'],
  ]);
  for (const row of callRows) {
    const engine = engineByFeature.get(String(row.feature));
    const markId = asString(row.correlation_id);
    if (!engine || !markId) continue;
    latestByMarkAndEngine.set(`${markId}:${engine}`, toEngineCall(row));
  }
  const cases: MarkCase[] = [];
  let unlabeled = 0;
  for (const row of markRows) {
    const markId = String(row.id);
    const truth = truthOf(row);
    if (!truth) {
      unlabeled += 1;
      continue;
    }
    cases.push({
      markId,
      omrState: String(row.state),
      doubtReason: asString(row.doubt_reason),
      margin: asNumber(row.margin) ?? 1,
      captureSource: asString(row.capture_source) ?? 'desconocida',
      truth: truth.truth,
      truthKind: truth.kind,
      jev: latestByMarkAndEngine.get(`${markId}:jev`) ?? null,
      openai: latestByMarkAndEngine.get(`${markId}:openai`) ?? null,
    });
  }
  return { cases, unlabeled };
}

interface CalibrationReport {
  generatedAt: string;
  database: string;
  grid: { step: number; combinationsTried: number; maxErrors: number };
  population: {
    humanCases: number;
    weakCases: number;
    unlabeledMarks: number;
  };
  engines: Record<EngineKey, ReturnType<typeof engineHealth>>;
  provisional: ConfigReport;
  best: ConfigReport | null;
}

interface ConfigReport {
  evaluation: Evaluation;
  slices: SliceReport[];
  weakTruth: ReturnType<typeof weakTruthReport>;
}

function configReport(
  human: MarkCase[],
  weak: MarkCase[],
  thresholds: ThresholdPair,
): ConfigReport {
  return {
    evaluation: evaluate(human, thresholds),
    slices: sliceReports(human, thresholds),
    weakTruth: weakTruthReport(weak, thresholds),
  };
}

function formatThresholds(t: ThresholdPair): string {
  const one = (x: ThresholdPair['jev']) =>
    `${x.agree.toFixed(2)}/${x.solo.toFixed(2)}/${x.unsure.toFixed(2)}`;
  return `Jev ${one(t.jev)} · OpenAI ${one(t.openai)} (agree/solo/unsure)`;
}

function configSection(title: string, report: ConfigReport): string[] {
  const { evaluation, slices, weakTruth } = report;
  const lines = [
    `### ${title}`,
    '',
    `Umbrales: ${formatThresholds(evaluation.thresholds)}`,
    '',
    '| Evaluadas | Automáticas | Errores | Cobertura | Cota sup. 95 % |',
    '|---:|---:|---:|---:|---:|',
    `| ${evaluation.n} | ${evaluation.auto} | ${evaluation.errors} | ${pct(evaluation.coverage)} | ${pct(evaluation.upperBound95, 2)} |`,
    '',
    `Veredictos: ${
      Object.entries(evaluation.verdicts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([verdict, count]) => `${verdict} ${count}`)
        .join(', ') || '—'
    }`,
    '',
    '| Corte (n >= 30 y 0 errores) | n | Automáticas | Errores | Cobertura | Cota sup. 95 % | Cumple |',
    '|---|---:|---:|---:|---:|---:|:---:|',
    ...slices.map(
      (slice) =>
        `| ${slice.name} | ${slice.stats.n} | ${slice.stats.auto} | ${slice.stats.errors} | ${pct(slice.stats.coverage)} | ${pct(slice.stats.upperBound95, 2)} | ${slice.meetsCriterion ? 'sí' : 'no'} |`,
    ),
    '',
    `Verdad débil (auto-anuladas por el OMR, n = ${weakTruth.n}): la IA habría aplicado ${weakTruth.auto}, de las cuales ${weakTruth.agreeWithNull} coinciden con la anulación del OMR. No es verdad humana; no cuenta en los errores de arriba.`,
    '',
  ];
  return lines;
}

function engineSection(report: CalibrationReport): string[] {
  const row = (label: string, health: CalibrationReport['engines']['jev']) =>
    `| ${label} | ${health.calls} | ${health.failed} | ${pct(health.failureRate)} | ${health.latencyP50Ms ?? '—'} | ${health.latencyP95Ms ?? '—'} | ${health.missingForMarks} |`;
  return [
    '## Motores',
    '',
    '| Motor | Llamadas | Fallas | Tasa de falla | p50 ms | p95 ms | Marcas sin llamada |',
    '|---|---:|---:|---:|---:|---:|---:|',
    row('Jev', report.engines.jev),
    row('OpenAI', report.engines.openai),
    '',
  ];
}

function renderMarkdown(report: CalibrationReport): string {
  const lines = [
    '# Calibración de la desambiguación de marcas',
    '',
    `Generado: ${report.generatedAt} · BDD: ${report.database}`,
    '',
    `Población: ${report.population.humanCases} marcas con verdad humana, ${report.population.weakCases} con verdad débil (auto-anuladas por el OMR), ${report.population.unlabeledMarks} sin verdad (excluidas).`,
    `Grilla: paso ${report.grid.step}, ${report.grid.combinationsTried.toLocaleString('es-CL')} combinaciones; criterio: a lo más ${report.grid.maxErrors} error(es).`,
    '',
    ...engineSection(report),
    '## Umbrales',
    '',
    ...configSection('Provisorios', report.provisional),
    ...(report.best
      ? configSection('Mejor combinación por cobertura', report.best)
      : [
          '### Mejor combinación por cobertura',
          '',
          'Ninguna combinación de la grilla cumple el criterio.',
          '',
        ]),
  ];
  return lines.join('\n');
}

function ensureLocalDatabase(url: string): void {
  const host = /@([^:/?]+)/.exec(url)?.[1] ?? /\/\/([^:/?@]+)/.exec(url)?.[1] ?? '';
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    console.error(`Me niego a leer una BDD que no es local (${maskUrl(url)}). Solo BDD local.`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  loadEnv();
  const url = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (o DATABASE_ADMIN_URL) en el entorno o en repositorio/.env');
    process.exit(1);
  }
  ensureLocalDatabase(url);
  if (!(STEP > 0 && STEP <= 0.5)) throw new Error('--step debe estar entre 0 y 0,5');
  console.log(`BDD: ${maskUrl(url)} (solo lectura)`);

  const postgres = loadPostgres();
  const sql = postgres(url, { max: 1, connect_timeout: 20, onnotice: () => undefined });
  try {
    const features = [FEATURE_BY_ENGINE.jev, FEATURE_BY_ENGINE.openai];
    const { markRows, callRows } = await sql.begin('read only', async (tx) => {
      if (ORG_ID) await tx.unsafe(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_ID]);
      return {
        markRows: await tx.unsafe(MARKS_SQL, [features]),
        callRows: await tx.unsafe(CALLS_SQL, [features]),
      };
    });

    const { cases, unlabeled } = buildCases(markRows, callRows);
    const human = cases.filter((markCase) => markCase.truthKind === 'human');
    const weak = cases.filter((markCase) => markCase.truthKind === 'weak');
    console.log(
      `Marcas con llamadas: ${markRows.length} (humanas ${human.length}, débiles ${weak.length}, sin verdad ${unlabeled})`,
    );

    const provisionalPair: ThresholdPair = { jev: PROVISIONAL_JEV, openai: PROVISIONAL_OPENAI };
    const grid = thresholdGrid(STEP);
    const search = searchBestThresholds(human, grid, MAX_ERRORS);
    if (search.best && search.bestFast) assertSameAsPairConsensus(search.best, search.bestFast);

    const report: CalibrationReport = {
      generatedAt: new Date().toISOString(),
      database: maskUrl(url),
      grid: { step: STEP, combinationsTried: search.combinationsTried, maxErrors: MAX_ERRORS },
      population: { humanCases: human.length, weakCases: weak.length, unlabeledMarks: unlabeled },
      engines: { jev: engineHealth(cases, 'jev'), openai: engineHealth(cases, 'openai') },
      provisional: configReport(human, weak, provisionalPair),
      best: search.best ? configReport(human, weak, search.best.thresholds) : null,
    };

    const dataDir = resolve(__dirname, 'data');
    mkdirSync(dataDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const mdPath = OUT_PATH ? resolve(OUT_PATH) : resolve(dataDir, `mark-calibration-${stamp}.md`);
    const jsonPath = resolve(dataDir, `mark-calibration-${stamp}.json`);
    writeFileSync(mdPath, renderMarkdown(report));
    writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`Reporte: ${mdPath}`);
    console.log(`JSON: ${jsonPath}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
