import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config as loadEnv } from 'dotenv';
import { decideAcceptance, verifyAnswer, type InkEvidence } from '@soe/answer-reading';
import { JevDecisionEngine } from '@soe/decisions';
import { DECISION_FEATURE_DEFAULTS } from '@soe/types';
import type { ReaderSpec } from '@soe/types';
import { LlmVisionTranscriber } from '../src/answer-reading/transcribers/llm-vision-transcriber';
import { estimateLlmCostUsd } from '../src/llm/llm.pricing';
import type { LlmProvider } from '../src/llm/llm.types';
import { AnthropicProvider } from '../src/llm/providers/anthropic.provider';
import { GeminiProvider } from '../src/llm/providers/gemini.provider';
import { OpenAiProvider } from '../src/llm/providers/openai.provider';
import { EvalLlmModule, applyEvalTariffs } from './answer-reading-eval/llm-context';
import type { CacheMode } from './answer-reading-eval/reading-cache';
import { RECOVERY_RULES, type RecoveryRule } from './answer-reading-eval/recovery-rules';
import {
  DecisionCache,
  type HarnessDecider,
  type HarnessDecisionRequest,
  type HarnessDecisionResult,
} from './answer-reading-eval/decision-cache';
import {
  allRouteReaders,
  loadRouteSet,
  parseReaderMinConfidence,
} from './answer-reading-eval/route-set';
import { runEvalCommand, type EvalCommandOptions } from './answer-reading-eval/run-eval';
import type { HarnessTranscriber, InterpretationSimulation } from './answer-reading-eval/simulate';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const DEFAULT_ROUTES = resolve(__dirname, 'answer-reading-eval', 'routes', 'actual.json');
const DEFAULT_CACHE_DIR = resolve(REPO_ROOT, '..', 'pruebas-vlm-manuscrito', 'cache-lecturas');
const DEFAULT_DECISION_CACHE_DIR = resolve(
  REPO_ROOT,
  '..',
  'pruebas-vlm-manuscrito',
  'cache-decisiones',
);
const JEV_INPUT_USD_PER_MTOK = 0.042;
const ESTIMATED_INPUT_TOKENS = 3000;
const OBSERVED_COST_MARGIN = 1.25;

const HELP = `Uso: pnpm --filter @soe/api answer-reading:eval --dataset <dir> [opciones]

  --dataset <dir>                Directorio con manifest.json e imágenes (obligatorio)
  --routes <archivo.json>        Conjunto de rutas ({ routes: [...] }) o una sola ReadingRoute
                                 (por defecto routes/actual.json). --route es un alias.
  --reader-min-confidence <m>    Umbral por lector, simulación provisional hasta T1
                                 (p. ej. "gemini-3.5-flash=0.97,gpt-6-luna=0.85")
  --repetitions <n>              Repeticiones por muestra (por defecto 1)
  --budget-usd <x>               Tope de gasto; obligatorio si faltan lecturas en el caché
  --concurrency <n>              Muestras en paralelo (por defecto 2)
  --cache-dir <dir>              Caché de lecturas (por defecto ../pruebas-vlm-manuscrito/cache-lecturas)
  --no-cache                     No lee ni escribe el caché
  --refresh                      Vuelve a pedir todo y reescribe el caché
  --out <dir>                    Carpeta de salida (por defecto una carpeta temporal)
  --dry-run                      Transcriptor falso que lee la etiqueta: no llama a ninguna API
  --offline                      Solo caché: nunca llama a una API; lo que falta queda como falla
  --ink <archivo.json>           Evidencia de tinta por muestra ({ id: { hasInk } }) para el
                                 blanco con evidencia de la lectura interpretada
  --reglas <lista>               Reglas de recuperación sin acuerdo, separadas por coma:
                                 key_anchor (Gemini lee la clave) y matching_column
                                 (un solo código de la columna en ambos lectores)
  --decision-cache-dir <dir>     Caché del desempate con el motor de decisiones
                                 (por defecto ../pruebas-vlm-manuscrito/cache-decisiones)
  --compare <informe.json>       Comparación pareada contra un informe v2 anterior
  --injected-escalation          Las lecturas inyectadas (estrés) entran como lecturas dudosas
                                 de los lectores de la ruta (confianza 0) para medir si el
                                 escalamiento (tiebreakOn) las confirma
`;

const FLAGS = new Set(['dry-run', 'no-cache', 'refresh', 'injected-escalation', 'offline']);

function numberOption(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} debe ser un número > 0`);
  return parsed;
}

function cacheModeOf(flags: ReadonlySet<string>): CacheMode {
  if (flags.has('no-cache') && flags.has('refresh')) {
    throw new Error('--no-cache y --refresh no se combinan');
  }
  if (flags.has('no-cache')) return 'off';
  return flags.has('refresh') ? 'refresh' : 'use';
}

function parseArgs(argv: readonly string[]): EvalCommandOptions {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(HELP);
      process.exit(0);
    }
    if (!arg.startsWith('--')) throw new Error(`Argumento inesperado: ${arg}`);
    const name = arg.slice(2);
    if (FLAGS.has(name)) {
      flags.add(name);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Falta el valor de ${arg}`);
    values.set(name === 'route' ? 'routes' : name, value);
    index += 1;
  }
  const dataset = values.get('dataset');
  if (!dataset) throw new Error('Falta --dataset');
  const budget = values.get('budget-usd');
  const thresholds = values.get('reader-min-confidence');
  const compare = values.get('compare');
  return {
    datasetDir: resolve(dataset),
    routesFile: resolve(values.get('routes') ?? DEFAULT_ROUTES),
    repetitions: Math.floor(numberOption(values.get('repetitions'), '--repetitions', 1)),
    concurrency: Math.floor(numberOption(values.get('concurrency'), '--concurrency', 2)),
    budgetUsd: budget === undefined ? null : numberOption(budget, '--budget-usd', 0),
    outDir: resolve(
      values.get('out') ??
        join(tmpdir(), `answer-reading-eval-${new Date().toISOString().replace(/[:.]/g, '-')}`),
    ),
    dryRun: flags.has('dry-run'),
    compareFile: compare ? resolve(compare) : null,
    cacheDir: resolve(values.get('cache-dir') ?? DEFAULT_CACHE_DIR),
    cacheMode: cacheModeOf(flags),
    readerMinConfidence: thresholds ? parseReaderMinConfidence(thresholds) : null,
    injectedEscalation: flags.has('injected-escalation'),
    offline: flags.has('offline'),
  };
}

function decisionCacheDirOf(argv: readonly string[]): string {
  const index = argv.indexOf('--decision-cache-dir');
  const value = index >= 0 ? argv[index + 1] : undefined;
  return resolve(value ?? DEFAULT_DECISION_CACHE_DIR);
}

class JevHarnessDecider implements HarnessDecider {
  readonly engine = DECISION_FEATURE_DEFAULTS.answer_reading_tiebreak.engine;
  readonly model = DECISION_FEATURE_DEFAULTS.answer_reading_tiebreak.model;
  private readonly jev = new JevDecisionEngine({ experimentalImages: true });

  async decide(request: HarnessDecisionRequest): Promise<HarnessDecisionResult> {
    const startedAt = Date.now();
    try {
      const result = await this.jev.evaluate({
        state: request.state,
        images: [{ mimeType: request.image.mimeType, data: request.image.base64 }],
        questions: request.questions,
        model: this.model,
      });
      const answer = Object.values(result.answers)[0];
      return {
        answer: answer?.type === 'choice' ? answer : null,
        model: result.model,
        usage: result.usage,
        costUsd: (result.usage.inputTokens * JEV_INPUT_USD_PER_MTOK) / 1e6,
        latencyMs: result.latencyMs,
        errorCode: answer?.type === 'choice' ? null : 'unexpected_answer',
      };
    } catch (error) {
      return {
        answer: null,
        model: this.model,
        usage: null,
        costUsd: 0,
        latencyMs: Date.now() - startedAt,
        errorCode: error instanceof Error ? error.name || 'error' : 'error',
      };
    }
  }
}

function argumentOf(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? (argv[index + 1] ?? null) : null;
}

function inkBySampleOf(file: string | null): ReadonlyMap<string, InkEvidence> | undefined {
  if (file === null) return undefined;
  const raw = JSON.parse(readFileSync(resolve(file), 'utf8')) as Record<
    string,
    { hasInk: boolean }
  >;
  return new Map(Object.entries(raw).map(([id, entry]) => [id, { hasInk: entry.hasInk }]));
}

function recoveryRulesOf(value: string | null): ReadonlySet<RecoveryRule> | undefined {
  if (value === null) return undefined;
  const rules = value.split(',').map((rule) => rule.trim());
  const unknown = rules.filter((rule) => !(RECOVERY_RULES as readonly string[]).includes(rule));
  if (unknown.length > 0) throw new Error(`Reglas desconocidas: ${unknown.join(', ')}`);
  return new Set(rules as RecoveryRule[]);
}

function interpretationSimulation(
  cacheMode: CacheMode,
  decisionCacheDir: string,
  offline: boolean,
  inkBySample: ReadonlyMap<string, InkEvidence> | undefined,
  recoveryRules: ReadonlySet<RecoveryRule> | undefined,
): InterpretationSimulation {
  const defaults = DECISION_FEATURE_DEFAULTS.answer_reading_tiebreak;
  return {
    verify: verifyAnswer,
    decideAcceptance,
    decisionCache: new DecisionCache(cacheMode === 'off' ? null : decisionCacheDir, cacheMode),
    decider: offline ? null : new JevHarnessDecider(),
    decisionEngine: defaults.engine,
    decisionModel: defaults.model,
    ...(inkBySample ? { inkBySample } : {}),
    ...(recoveryRules ? { recoveryRules } : {}),
  };
}

function estimateCallUsd(reader: ReaderSpec, observedUsd: readonly number[]): number {
  if (observedUsd.length > 0) return Math.max(...observedUsd) * OBSERVED_COST_MARGIN;
  const worstCase = estimateLlmCostUsd(reader.model, {
    inputTokens: ESTIMATED_INPUT_TOKENS,
    outputTokens: reader.params.maxOutputTokens,
  });
  if (worstCase === null) throw new Error(`Sin tarifa para ${reader.model}`);
  return Number(worstCase);
}

function availableTranscriber(
  context: INestApplicationContext,
): (reader: ReaderSpec) => HarnessTranscriber | null {
  const transcriber = context.get(LlmVisionTranscriber);
  const providers = new Map<string, LlmProvider>([
    ['anthropic', context.get(AnthropicProvider)],
    ['gemini', context.get(GeminiProvider)],
    ['openai', context.get(OpenAiProvider)],
  ]);
  return (reader) =>
    transcriber.supports(reader) && (providers.get(reader.provider)?.isAvailable() ?? false)
      ? transcriber
      : null;
}

async function main(): Promise<void> {
  loadEnv({ path: join(REPO_ROOT, '.env') });
  const options = parseArgs(process.argv.slice(2));
  const log = (message: string) => process.stderr.write(`${message}\n`);
  applyEvalTariffs();
  const context =
    options.dryRun || options.offline
      ? null
      : await NestFactory.createApplicationContext(
          EvalLlmModule.forReaders(allRouteReaders(await loadRouteSet(options.routesFile))),
          { logger: ['error', 'warn'] },
        );
  try {
    const result = await runEvalCommand(options, {
      log,
      estimateCallUsd,
      interpretation: interpretationSimulation(
        options.cacheMode,
        decisionCacheDirOf(process.argv.slice(2)),
        options.offline === true,
        inkBySampleOf(argumentOf(process.argv.slice(2), 'ink')),
        recoveryRulesOf(argumentOf(process.argv.slice(2), 'reglas')),
      ),
      ...(context ? { transcriberFor: availableTranscriber(context) } : {}),
    });
    const { short, cost } = result.report.metrics;
    log(
      `Autoaceptadas ${short.autoAccepted.count}/${short.autoAccepted.total} · equivocadas ${short.autoAcceptedWrong.count} (perjudican ${short.harmsStudent.count}, favorecen ${short.favorsStudent.count}) · caché ${result.cacheStats.hits} aciertos, ${result.cacheStats.writes} escrituras · gasto real US$${cost.spentUsd.toFixed(5)}`,
    );
    for (const file of result.files) log(`Escrito: ${file}`);
  } finally {
    await context?.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
