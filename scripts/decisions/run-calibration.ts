/**
 * Calibración del motor de decisiones (Jev) contra los goldsets locales.
 *
 *   packages/db/node_modules/.bin/tsx --tsconfig scripts/decisions/tsconfig.json \
 *     scripts/decisions/run-calibration.ts [--engine jev|fake] [--set remedial|taxonomy|all] \
 *     [--limit N] [--concurrency N] [--min-confidence X] [--out ruta.md]
 *
 * - `--engine jev` (default) necesita `TYPESAFE_API_KEY` (entorno o `repositorio/.env`).
 *   `--engine fake` usa `FakeDecisionEngine` con respuestas pseudoaleatorias
 *   deterministas: solo prueba el flujo, sus números no significan nada.
 * - Juez remedial: usa `buildJudgeDecision` de la API TAL CUAL (mismo estado y mismas
 *   preguntas que corren en producción). Verdad de `clave` = alternativa `isCorrect`.
 * - Taxonomía: `hierarchicalChoice` con `minConfidence = 0` (baja siempre hasta la hoja)
 *   y guarda la confianza de cada nivel; los umbrales se simulan después sobre esos datos.
 *
 * IDIOMA: las instrucciones y las claves del estado van en ESPAÑOL (las del juez vienen
 * de `judge-decision.ts`; las de taxonomía están abajo). Jev rinde mejor en inglés: lo
 * que medimos aquí es su desempeño con el español que usará el producto.
 *
 * Salida: `docs/calibracion-jev.md` (solo con `--engine jev`; con `fake` va a
 * `scripts/decisions/data/`) + JSON crudo en `scripts/decisions/data/results-<fecha>.json`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, relative, resolve } from 'path';
import {
  DecisionError,
  FakeDecisionEngine,
  JevDecisionEngine,
  JEV_API_KEY_ENV,
  JEV_DEFAULT_MODEL,
  hierarchicalChoice,
  type DecisionAnswer,
  type DecisionEngine,
  type DecisionQuestion,
  type DecisionQuestions,
  type DecisionRequest,
  type DecisionResult,
  type DecisionState,
  type JsonObject,
} from '../../packages/decisions/src/index';
import {
  buildJudgeDecision,
  JUDGE_DECISION_VERSION,
} from '../../apps/api/src/remedial/judge-decision';
import {
  accuracyOf,
  calibrationTable,
  coverageCurve,
  mdTable,
  noulAgreement,
  num,
  pct,
  percentile,
  suggestThreshold,
  summarizeProbabilities,
  type ScoredDecision,
} from './calibration-metrics';
import { loadEnv, REPO_ROOT } from './env';
import type {
  GoldDimension,
  GoldTreeNode,
  RemedialGoldItem,
  RemedialGoldset,
  TaxonomyGoldItem,
  TaxonomyGoldset,
  TaxonomyGoldTask,
} from './goldset-types';

const INSTRUCTION_LANGUAGE = 'es (español neutro)';
/** USD por millón de tokens de entrada (Jev no cobra salida). */
const JEV_INPUT_USD_PER_MTOK = 0.042;
const DATA_DIR = resolve(__dirname, 'data');
const TAXONOMY_THRESHOLDS: readonly number[] = [0, 0.5, 0.6, 0.7, 0.8, 0.9];

// ── Argumentos ───────────────────────────────────────────────────────────────

type EngineId = 'jev' | 'fake';
type SetId = 'remedial' | 'taxonomy' | 'all';

interface CliOptions {
  engine: EngineId;
  set: SetId;
  limit: number | null;
  concurrency: number;
  out: string | null;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const value = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    if (i >= 0) return argv[i + 1];
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    return eq ? eq.slice(name.length + 3) : undefined;
  };
  const engine = value('engine') ?? 'jev';
  if (engine !== 'jev' && engine !== 'fake')
    fail(`--engine debe ser jev o fake (llegó "${engine}")`);
  const set = value('set') ?? 'all';
  if (set !== 'remedial' && set !== 'taxonomy' && set !== 'all')
    fail(`--set debe ser remedial, taxonomy o all`);
  const limitRaw = value('limit');
  const limit = limitRaw === undefined ? null : Number.parseInt(limitRaw, 10);
  if (limit !== null && (!Number.isFinite(limit) || limit < 1))
    fail('--limit debe ser un entero >= 1');
  const concurrency = Number.parseInt(value('concurrency') ?? '4', 10);
  if (!Number.isFinite(concurrency) || concurrency < 1)
    fail('--concurrency debe ser un entero >= 1');
  return { engine, set, limit, concurrency, out: value('out') ?? null };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// ── Motor ────────────────────────────────────────────────────────────────────

interface CallRecord {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/** Envuelve un motor y registra latencia, tokens y modelo de cada llamada. */
class RecordingEngine implements DecisionEngine {
  readonly calls: CallRecord[] = [];
  readonly name: string;

  constructor(private readonly inner: DecisionEngine) {
    this.name = inner.name;
  }

  isAvailable(): boolean {
    return this.inner.isAvailable();
  }

  async evaluate<Q extends DecisionQuestions>(
    request: DecisionRequest<Q>,
  ): Promise<DecisionResult<Q>> {
    const result = await this.inner.evaluate(request);
    this.calls.push({
      latencyMs: result.latencyMs,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      model: result.model,
    });
    return result;
  }
}

/** FNV-1a de 32 bits → [0, 1). Determinista para que el modo fake sea reproducible. */
function hashUnit(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

/** Respuesta pseudoaleatoria (pero coherente en forma) para el motor falso. */
function fakeAnswer(state: DecisionState, question: DecisionQuestion): DecisionAnswer {
  const seed =
    JSON.stringify(state) +
    JSON.stringify(question.instructions) +
    JSON.stringify(question.criteria ?? null);
  if (question.type === 'noul') return { type: 'noul', probability: 0.05 + 0.9 * hashUnit(seed) };
  if (question.type === 'choice') {
    const options = Object.keys(question.criteria);
    const n = options.length;
    const winner = Math.floor(hashUnit(`${seed}#w`) * n);
    const peak = n === 1 ? 1 : 1 / n + (1 - 1 / n) * hashUnit(`${seed}#p`);
    const probabilities: Record<string, number> = {};
    options.forEach(
      (o, i) => (probabilities[o] = i === winner ? peak : (1 - peak) / Math.max(1, n - 1)),
    );
    const confidence = n === 1 ? 1 : Math.max(0, Math.min(1, (n * peak - 1) / (n - 1)));
    return {
      type: 'choice',
      choice: options[winner] ?? options[0] ?? '',
      probabilities,
      confidence,
    };
  }
  const levels = question.criteria.length;
  const probabilities = new Array<number>(levels).fill(1 / levels);
  return { type: 'score', score: (levels - 1) / 2, level: 0, probabilities, confidence: 0 };
}

function buildEngine(id: EngineId): DecisionEngine {
  if (id === 'fake') {
    const answers = Object.fromEntries(
      ['clave', 'respuesta_unica', 'factual', 'habilidad', 'node'].map((qid) => [qid, fakeAnswer]),
    );
    return new FakeDecisionEngine({ answers, usage: { inputTokens: 500, outputTokens: 30 } });
  }
  const engine = new JevDecisionEngine({ maxRetries: 3 });
  if (!engine.isAvailable()) {
    fail(
      `Falta ${JEV_API_KEY_ENV}. Defínela en el entorno o en repositorio/.env, ` +
        'o corre con --engine fake para probar el flujo sin llamar a Jev.',
    );
  }
  return engine;
}

// ── Utilidades ───────────────────────────────────────────────────────────────

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const item = items[i];
      if (item === undefined) return;
      results[i] = await fn(item, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function errorCode(err: unknown): string {
  if (err instanceof DecisionError) return err.code;
  return err instanceof Error ? `unexpected:${err.message}` : 'unexpected';
}

/** Errores que invalidan toda la corrida: no tiene sentido seguir llamando. */
function isFatal(err: unknown): boolean {
  return err instanceof DecisionError && (err.code === 'auth' || err.code === 'unavailable');
}

function readJson<T>(path: string): T {
  if (!existsSync(path))
    fail(`No existe ${relative(REPO_ROOT, path)}. Corre primero extract-goldsets.ts.`);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function progress(label: string, done: number, total: number): void {
  if (done === total || done % 10 === 0) console.log(`  ${label}: ${done}/${total}`);
}

// ── Juez remedial ────────────────────────────────────────────────────────────

interface RemedialRun {
  itemId: string;
  origin: RemedialGoldItem['origin'];
  subjectCode: string | null;
  isMath: boolean;
  correctKey: string;
  error: string | null;
  clave: { choice: string; confidence: number; probabilities: Record<string, number> } | null;
  nouls: { respuesta_unica: number; factual: number; habilidad: number } | null;
  llmVerdict: RemedialGoldItem['judgeVerdict'];
  latencyMs: number | null;
  model: string | null;
}

async function runRemedial(
  engine: DecisionEngine,
  items: readonly RemedialGoldItem[],
  concurrency: number,
): Promise<{ runs: RemedialRun[]; calls: CallRecord[] }> {
  const recorder = new RecordingEngine(engine);
  let done = 0;
  const runs = await mapPool(items, concurrency, async (item): Promise<RemedialRun> => {
    const base = {
      itemId: item.itemId,
      origin: item.origin,
      subjectCode: item.subjectCode,
      isMath: item.isMath,
      correctKey: item.correctKey,
      llmVerdict: item.judgeVerdict,
    };
    // El juez NO ve cuál es la correcta: solo `{ key, text }`.
    const { state, questions } = buildJudgeDecision(item.stimulus, {
      stem: item.stem,
      alternatives: item.alternatives.map(({ key, text }) => ({ key, text })),
    });
    try {
      const result = await recorder.evaluate({ state, questions });
      const { clave, respuesta_unica, factual, habilidad } = result.answers;
      return {
        ...base,
        error: null,
        clave: {
          choice: clave.choice,
          confidence: clave.confidence,
          probabilities: { ...clave.probabilities },
        },
        nouls: {
          respuesta_unica: respuesta_unica.probability,
          factual: factual.probability,
          habilidad: habilidad.probability,
        },
        latencyMs: result.latencyMs,
        model: result.model,
      };
    } catch (err) {
      if (isFatal(err)) throw err;
      return {
        ...base,
        error: errorCode(err),
        clave: null,
        nouls: null,
        latencyMs: null,
        model: null,
      };
    } finally {
      progress('remedial', ++done, items.length);
    }
  });
  return { runs, calls: recorder.calls };
}

// ── Taxonomía ────────────────────────────────────────────────────────────────

/** Instrucción del Choice jerárquico según el tipo de hoja de la dimensión. */
function taxonomyInstruction(dimension: GoldDimension): string {
  switch (dimension.leafType) {
    case 'skill':
      return '¿Qué opción corresponde a la habilidad que evalúa la `pregunta`?';
    case 'text_type':
      return '¿Qué opción corresponde al tipo de texto del `pasaje`?';
    default:
      return '¿Qué opción corresponde al contenido curricular que evalúa la `pregunta`?';
  }
}

function taxonomyState(item: TaxonomyGoldItem): DecisionState {
  const alternativas: JsonObject = {};
  for (const a of item.alternatives) alternativas[a.key] = a.text;
  const state: JsonObject = {
    asignatura: item.subjectName ?? '',
    curso: item.gradeName ?? '',
    pregunta: item.stem,
    alternativas,
  };
  if (item.stimulus) state.pasaje = { titulo: item.stimulus.title, texto: item.stimulus.text };
  return state;
}

interface TaxonomyStep {
  id: string;
  confidence: number;
  /** Cantidad de hermanos en ese nivel (1 = no se consultó al motor). */
  options: number;
  /** El nodo es un tag humano o ancestro de uno. */
  onGoldPath: boolean;
}

interface TaxonomyRun {
  itemId: string;
  dimension: string;
  subjectCode: string | null;
  isMath: boolean;
  gold: string[];
  error: string | null;
  steps: TaxonomyStep[];
  leafCorrect: boolean | null;
}

function goldPathSet(dimension: GoldDimension, gold: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const g of gold) {
    set.add(g);
    for (const a of dimension.ancestors[g] ?? []) set.add(a);
  }
  return set;
}

/** Cuenta los hermanos de cada nivel recorriendo el árbol por el camino elegido. */
function siblingCounts(tree: readonly GoldTreeNode[], path: readonly string[]): number[] {
  const counts: number[] = [];
  let level: readonly GoldTreeNode[] | undefined = tree;
  for (const id of path) {
    if (!level) break;
    counts.push(level.length);
    level = level.find((n) => n.id === id)?.children;
  }
  return counts;
}

async function runTaxonomy(
  engine: DecisionEngine,
  goldset: TaxonomyGoldset,
  items: readonly TaxonomyGoldItem[],
  concurrency: number,
): Promise<{ runs: TaxonomyRun[]; calls: CallRecord[] }> {
  const dimensions = new Map(goldset.dimensions.map((d) => [d.key, d]));
  const recorder = new RecordingEngine(engine);
  const tasks: { item: TaxonomyGoldItem; task: TaxonomyGoldTask; dimension: GoldDimension }[] = [];
  for (const item of items) {
    for (const task of item.tasks) {
      const dimension = dimensions.get(task.dimension);
      if (!dimension) continue;
      if (dimension.leafType === 'text_type' && !item.stimulus) continue;
      tasks.push({ item, task, dimension });
    }
  }

  let done = 0;
  const runs = await mapPool(
    tasks,
    concurrency,
    async ({ item, task, dimension }): Promise<TaxonomyRun> => {
      const base = {
        itemId: item.itemId,
        dimension: dimension.key,
        subjectCode: item.subjectCode,
        isMath: item.isMath,
        gold: task.goldNodeIds,
      };
      try {
        const result = await hierarchicalChoice(recorder, {
          state: taxonomyState(item),
          instructions: taxonomyInstruction(dimension),
          tree: dimension.tree,
          minConfidence: 0,
        });
        const onPath = goldPathSet(dimension, task.goldNodeIds);
        const counts = siblingCounts(
          dimension.tree,
          result.path.map((s) => s.id),
        );
        const steps: TaxonomyStep[] = result.path.map((s, i) => ({
          id: s.id,
          confidence: s.confidence,
          options: counts[i] ?? 0,
          onGoldPath: onPath.has(s.id),
        }));
        const leaf = steps[steps.length - 1];
        return {
          ...base,
          error: null,
          steps,
          leafCorrect: leaf ? task.goldNodeIds.includes(leaf.id) : false,
        };
      } catch (err) {
        if (isFatal(err)) throw err;
        return { ...base, error: errorCode(err), steps: [], leafCorrect: null };
      } finally {
        progress('taxonomía', ++done, tasks.length);
      }
    },
  );
  return { runs, calls: recorder.calls };
}

type TaxonomyOutcome = 'leaf_ok' | 'leaf_wrong' | 'stopped_ok' | 'stopped_wrong' | 'abstained';

/** Resultado de una tarea si el producto cortara el descenso en `threshold`. */
function outcomeAt(run: TaxonomyRun, threshold: number): TaxonomyOutcome {
  const cut = run.steps.findIndex((s) => s.confidence < threshold);
  const kept = cut === -1 ? run.steps : run.steps.slice(0, cut);
  const last = kept[kept.length - 1];
  if (!last) return 'abstained';
  if (cut === -1) return run.leafCorrect ? 'leaf_ok' : 'leaf_wrong';
  return kept.every((s) => s.onGoldPath) ? 'stopped_ok' : 'stopped_wrong';
}

/** Decisiones reales de un nivel (más de una opción) con el prefijo aún correcto. */
function taxonomyStepDecisions(runs: readonly TaxonomyRun[]): ScoredDecision[] {
  const out: ScoredDecision[] = [];
  for (const run of runs) {
    for (const step of run.steps) {
      if (step.options > 1) out.push({ confidence: step.confidence, correct: step.onGoldPath });
      if (!step.onGoldPath) break;
    }
  }
  return out;
}

// ── Reporte ──────────────────────────────────────────────────────────────────

function usageSection(label: string, calls: readonly CallRecord[]): string[] {
  const latencies = calls.map((c) => c.latencyMs);
  const input = calls.reduce((s, c) => s + c.inputTokens, 0);
  const output = calls.reduce((s, c) => s + c.outputTokens, 0);
  const cost = (input / 1_000_000) * JEV_INPUT_USD_PER_MTOK;
  return [
    mdTable(
      [
        'Set',
        'Llamadas',
        'Latencia p50 (ms)',
        'Latencia p95 (ms)',
        'Tokens entrada',
        'Tokens salida',
        'Costo USD',
      ],
      [
        [
          label,
          String(calls.length),
          num(percentile(latencies, 50), 0),
          num(percentile(latencies, 95), 0),
          String(input),
          String(output),
          cost.toFixed(6),
        ],
      ],
    ),
  ];
}

function calibrationSection(records: readonly ScoredDecision[]): string {
  return mdTable(
    ['Tramo de confianza', 'n', '% del total', 'Exactitud', 'Confianza media'],
    calibrationTable(records).map((r) => [
      r.label,
      String(r.n),
      pct(r.share),
      pct(r.accuracy),
      num(r.meanConfidence),
    ]),
  );
}

function coverageSection(records: readonly ScoredDecision[]): string[] {
  const curve = coverageCurve(records);
  const suggested = suggestThreshold(curve);
  return [
    mdTable(
      ['Umbral (confidence >=)', 'Cobertura', 'n cubiertos', 'Exactitud cubiertos'],
      curve.map((p) => [num(p.threshold), pct(p.coverage), String(p.n), pct(p.accuracy)]),
    ),
    '',
    suggested
      ? `**Umbral sugerido para exactitud >= 95%:** \`${num(suggested.threshold)}\` (cobertura ${pct(suggested.coverage)}, n = ${suggested.n}).`
      : '**Umbral sugerido para exactitud >= 95%:** ninguno de los umbrales 0.50–0.95 lo alcanza con n >= 10.',
  ];
}

function groupBy<T>(xs: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = out.get(k);
    if (list) list.push(x);
    else out.set(k, [x]);
  }
  return out;
}

function remedialReport(runs: readonly RemedialRun[], calls: readonly CallRecord[]): string[] {
  const ok = runs.filter((r) => r.clave !== null);
  const scored = (rs: readonly RemedialRun[]): ScoredDecision[] =>
    rs.flatMap((r) =>
      r.clave ? [{ confidence: r.clave.confidence, correct: r.clave.choice === r.correctKey }] : [],
    );
  const all = scored(ok);
  const math = scored(ok.filter((r) => r.isMath));
  const nonMath = scored(ok.filter((r) => !r.isMath));

  const out: string[] = ['## Juez remedial', ''];
  out.push(
    `Preguntas: \`${JUDGE_DECISION_VERSION}\` (\`apps/api/src/remedial/judge-decision.ts\`, sin cambios). ` +
      `n = ${runs.length} ítems (${runs.filter((r) => r.origin === 'remedial').length} generados por el motor remedial, ` +
      `${runs.filter((r) => r.origin === 'bank').length} del banco oficial/importado); errores: ${runs.length - ok.length}.`,
    '',
    '### `clave`: exactitud contra la alternativa `isCorrect`',
    '',
    mdTable(
      ['Grupo', 'n', 'Exactitud', 'Confianza media'],
      [
        [
          'Todos',
          String(all.length),
          pct(accuracyOf(all)),
          num(average(all.map((r) => r.confidence))),
        ],
        [
          'Matemática',
          String(math.length),
          pct(accuracyOf(math)),
          num(average(math.map((r) => r.confidence))),
        ],
        [
          'Resto',
          String(nonMath.length),
          pct(accuracyOf(nonMath)),
          num(average(nonMath.map((r) => r.confidence))),
        ],
        ...[...groupBy(ok, (r) => `${r.origin} / ${r.subjectCode ?? '?'}`).entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, rs]) => {
            const s = scored(rs);
            return [
              k,
              String(s.length),
              pct(accuracyOf(s)),
              num(average(s.map((r) => r.confidence))),
            ];
          }),
      ],
    ),
    '',
    '### Calibración de `clave` (todos)',
    '',
    calibrationSection(all),
    '',
    '### Cobertura vs exactitud de `clave` (todos)',
    '',
    ...coverageSection(all),
    '',
    '### Cobertura vs exactitud de `clave` (sin matemática)',
    '',
    ...coverageSection(nonMath),
    '',
  );

  // Acuerdo con el juez LLM (solo ítems con veredicto guardado): NO es verdad.
  const withVerdict = ok.filter((r) => r.llmVerdict && r.nouls);
  const agreementRow = (
    label: string,
    pick: (r: RemedialRun) => { probability: number; reference: boolean },
  ) => {
    const a = noulAgreement(withVerdict.map(pick));
    return [
      label,
      String(a.n),
      `${a.referenceTrue}/${a.n}`,
      pct(a.agreement),
      num(a.meanWhenReferenceTrue),
      num(a.meanWhenReferenceFalse),
    ];
  };
  const derived = withVerdict.filter((r) => r.llmVerdict?.derivedAnswer);
  const derivedAgree = derived.filter(
    (r) => r.llmVerdict?.derivedAnswer === r.clave?.choice,
  ).length;
  out.push(
    '### Noul vs veredicto guardado del juez LLM',
    '',
    `Solo los ${withVerdict.length} ítems generados con \`quality_report\`. El juez LLM no es verdad: esto mide acuerdo, no exactitud. ` +
      'Corte de P(sí) en 0.5.',
    '',
    mdTable(
      [
        'Pregunta Jev',
        'n',
        'LLM dijo sí',
        'Acuerdo',
        'P(sí) media si LLM=sí',
        'P(sí) media si LLM=no',
      ],
      withVerdict.length === 0
        ? []
        : [
            agreementRow('respuesta_unica ↔ uniqueCorrect', (r) => ({
              probability: r.nouls?.respuesta_unica ?? 0,
              reference: r.llmVerdict?.uniqueCorrect ?? false,
            })),
            agreementRow('factual ↔ factual', (r) => ({
              probability: r.nouls?.factual ?? 0,
              reference: r.llmVerdict?.factual ?? false,
            })),
            agreementRow('habilidad ↔ skillMatch', (r) => ({
              probability: r.nouls?.habilidad ?? 0,
              reference: r.llmVerdict?.skillMatch ?? false,
            })),
          ],
    ),
    '',
    `\`clave\` de Jev = \`derivedAnswer\` del juez LLM en ${derivedAgree}/${derived.length} ítems.`,
    '',
    '### Distribución de los Noul en todos los ítems',
    '',
    'Los ítems del banco son oficiales y se asumen válidos (clave única, sin errores): una P(sí) baja ahí sugiere falsos rechazos, ' +
      'pero no hay verdad etiquetada para estos Noul.',
    '',
    mdTable(
      ['Pregunta', 'Grupo', 'n', 'P(sí) media', 'P(sí) p10', 'P(sí) mín', '% con P(sí) >= 0.5'],
      (['respuesta_unica', 'factual', 'habilidad'] as const).flatMap((q) =>
        [...groupBy(ok, (r) => (r.isMath ? 'matemática' : 'resto')).entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([g, rs]) => {
            const s = summarizeProbabilities(rs.map((r) => r.nouls?.[q] ?? 0));
            return [q, g, String(s.n), num(s.mean), num(s.p10), num(s.min), pct(s.shareYes)];
          }),
      ),
    ),
    '',
    '### Latencia, tokens y costo',
    '',
    ...usageSection('remedial', calls),
    '',
  );
  return out;
}

function taxonomyReport(
  runs: readonly TaxonomyRun[],
  calls: readonly CallRecord[],
  goldset: TaxonomyGoldset,
): string[] {
  const ok = runs.filter((r) => r.error === null);
  const out: string[] = ['## Taxonomía (`hierarchicalChoice`)', ''];
  out.push(
    `n = ${runs.length} tareas (ítem × dimensión) sobre ${new Set(runs.map((r) => r.itemId)).size} ítems; errores: ${runs.length - ok.length}. ` +
      'Se desciende siempre hasta la hoja (`minConfidence = 0`) y los umbrales se simulan cortando en el primer nivel con confianza menor.',
    '',
    'Instrucciones usadas (una por tipo de hoja, igual en todos los niveles):',
    '',
    ...[
      ...new Map(goldset.dimensions.map((d) => [taxonomyInstruction(d), d.leafType])).entries(),
    ].map(
      ([instr]) =>
        `- ${goldset.dimensions
          .filter((d) => taxonomyInstruction(d) === instr)
          .map((d) => `\`${d.key}\``)
          .join(', ')}: «${instr}»`,
    ),
    '',
    '### Hoja final vs tags humanos (sin umbral)',
    '',
    mdTable(
      [
        'Dimensión',
        'n',
        'Hoja = tag humano',
        'Todos los niveles en el camino correcto hasta el penúltimo',
      ],
      [
        ...groupBy(ok, (r) => r.dimension).entries(),
        ['TODAS', ok] as [string, TaxonomyRun[]],
        ['Matemática', ok.filter((r) => r.isMath)] as [string, TaxonomyRun[]],
        ['Resto', ok.filter((r) => !r.isMath)] as [string, TaxonomyRun[]],
      ].map(([k, rs]) => {
        const leafOk = rs.filter((r) => r.leafCorrect).length;
        const prefixOk = rs.filter((r) => r.steps.slice(0, -1).every((s) => s.onGoldPath)).length;
        return [
          k,
          String(rs.length),
          pct(rs.length ? leafOk / rs.length : null),
          pct(rs.length ? prefixOk / rs.length : null),
        ];
      }),
    ),
    '',
    '### Si el producto corta el descenso en un umbral',
    '',
    '"Coincide" = la hoja es un tag humano, o se detuvo antes y todo el camino recorrido es ancestro de un tag humano.',
    '',
    mdTable(
      [
        'Umbral',
        'Hoja correcta',
        'Hoja incorrecta',
        'Detenido, camino correcto',
        'Detenido, camino incorrecto',
        'Sin decisión',
        'Coincide',
      ],
      TAXONOMY_THRESHOLDS.map((t) => {
        const counts: Record<TaxonomyOutcome, number> = {
          leaf_ok: 0,
          leaf_wrong: 0,
          stopped_ok: 0,
          stopped_wrong: 0,
          abstained: 0,
        };
        for (const r of ok) counts[outcomeAt(r, t)]++;
        const n = ok.length || 1;
        return [
          num(t),
          pct(counts.leaf_ok / n),
          pct(counts.leaf_wrong / n),
          pct(counts.stopped_ok / n),
          pct(counts.stopped_wrong / n),
          pct(counts.abstained / n),
          pct((counts.leaf_ok + counts.stopped_ok) / n),
        ];
      }),
    ),
    '',
    '### Calibración por nivel (decisiones con más de una opción y prefijo correcto)',
    '',
    calibrationSection(taxonomyStepDecisions(ok)),
    '',
    ...coverageSection(taxonomyStepDecisions(ok)),
    '',
    '### Latencia, tokens y costo',
    '',
    ...usageSection('taxonomía', calls),
    '',
  );
  return out;
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  loadEnv();
  const engine = buildEngine(opts.engine);
  const started = new Date();
  const stamp = started.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  console.log(
    `Motor: ${engine.name} · set: ${opts.set} · límite: ${opts.limit ?? 'todos'} · concurrencia: ${opts.concurrency}`,
  );

  const take = <T>(xs: readonly T[]): T[] =>
    opts.limit === null ? [...xs] : xs.slice(0, opts.limit);
  let remedial: { runs: RemedialRun[]; calls: CallRecord[] } | null = null;
  let taxonomy: { runs: TaxonomyRun[]; calls: CallRecord[] } | null = null;
  let taxonomyGold: TaxonomyGoldset | null = null;

  try {
    if (opts.set !== 'taxonomy') {
      const gold = readJson<RemedialGoldset>(resolve(DATA_DIR, 'goldset-remedial.json'));
      remedial = await runRemedial(engine, take(gold.items), opts.concurrency);
    }
    if (opts.set !== 'remedial') {
      taxonomyGold = readJson<TaxonomyGoldset>(resolve(DATA_DIR, 'goldset-taxonomy.json'));
      taxonomy = await runTaxonomy(
        engine,
        taxonomyGold,
        take(taxonomyGold.items),
        opts.concurrency,
      );
    }
  } catch (err) {
    fail(
      `Corrida abortada (${errorCode(err)}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const allCalls = [...(remedial?.calls ?? []), ...(taxonomy?.calls ?? [])];
  const models = [...new Set(allCalls.map((c) => c.model))];
  const warnings: string[] = [];
  if (opts.engine === 'fake')
    warnings.push(
      'Corrida con **motor falso**: respuestas pseudoaleatorias; los números NO significan nada.',
    );
  if (opts.limit !== null) warnings.push(`Corrida parcial: \`--limit ${opts.limit}\` por set.`);
  warnings.push(
    'Instrucciones en español: Jev rinde mejor en inglés (docs de TypeSafe); los números miden el español que usará el producto.',
    'Aritmética y conteo son puntos débiles documentados de Jev (jaggedness #2): mira por separado las filas de matemática.',
    'Los ítems remediales con veredicto del juez LLM son pocos y de una sola asignatura (Lenguaje); el acuerdo de los Noul es indicativo.',
    'Ítems del banco con fórmulas extraídas de PDF pueden tener símbolos perdidos (exponentes, fracciones): el extractor filtra los casos evidentes, no todos.',
    'Taxonomía: el estado incluye asignatura y curso del instrumento (lo que sabría el producto al etiquetar).',
  );

  const lines: string[] = [
    '# Calibración del motor de decisiones (Jev)',
    '',
    `> Generado por \`scripts/decisions/run-calibration.ts\` el ${started.toISOString().slice(0, 10)}. No editar a mano: vuelve a correr el script.`,
    '',
    mdTable(
      ['Campo', 'Valor'],
      [
        ['Fecha', started.toISOString()],
        ['Motor', engine.name],
        ['Modelo pedido', opts.engine === 'jev' ? JEV_DEFAULT_MODEL : 'fake'],
        ['Modelo que respondió', models.length ? models.join(', ') : '—'],
        ['Idioma de las instrucciones', INSTRUCTION_LANGUAGE],
        ['n remedial', remedial ? String(remedial.runs.length) : 'no corrido'],
        ['n taxonomía (tareas)', taxonomy ? String(taxonomy.runs.length) : 'no corrido'],
        ['Concurrencia', String(opts.concurrency)],
        ['Precio', `${JEV_INPUT_USD_PER_MTOK} USD / millón de tokens de entrada`],
      ],
    ),
    '',
    '## Advertencias',
    '',
    ...warnings.map((w) => `- ${w}`),
    '',
    ...(remedial ? remedialReport(remedial.runs, remedial.calls) : []),
    ...(taxonomy && taxonomyGold
      ? taxonomyReport(taxonomy.runs, taxonomy.calls, taxonomyGold)
      : []),
    '## Total',
    '',
    ...usageSection('todos', allCalls),
    '',
  ];

  mkdirSync(DATA_DIR, { recursive: true });
  const rawPath = resolve(
    DATA_DIR,
    `results-${stamp}${opts.engine === 'fake' ? '-fake' : ''}.json`,
  );
  writeFileSync(
    rawPath,
    JSON.stringify(
      {
        startedAt: started.toISOString(),
        engine: engine.name,
        models,
        instructionLanguage: INSTRUCTION_LANGUAGE,
        judgeDecisionVersion: JUDGE_DECISION_VERSION,
        options: opts,
        remedial: remedial?.runs ?? null,
        taxonomy: taxonomy?.runs ?? null,
        calls: { remedial: remedial?.calls ?? [], taxonomy: taxonomy?.calls ?? [] },
      },
      null,
      2,
    ),
  );

  const reportPath = opts.out
    ? resolve(opts.out)
    : opts.engine === 'jev'
      ? resolve(REPO_ROOT, 'docs', 'calibracion-jev.md')
      : resolve(DATA_DIR, `calibracion-fake-${stamp}.md`);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, lines.join('\n'));
  console.log(`Reporte: ${relative(REPO_ROOT, reportPath)}`);
  console.log(`JSON crudo: ${relative(REPO_ROOT, rawPath)}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
