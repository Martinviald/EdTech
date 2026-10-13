import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Module, type DynamicModule, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config as loadEnv } from 'dotenv';
import type { Database } from '@soe/db';
import type { LlmModel, LlmProviderId, ReaderSpec } from '@soe/types';
import { LlmVisionTranscriber } from '../src/answer-reading/transcribers/llm-vision-transcriber';
import { LlmConfigService } from '../src/llm/llm.config';
import { LLM_PROVIDERS } from '../src/llm/llm.constants';
import { LlmModelsService } from '../src/llm/llm-models.service';
import { estimateLlmCostUsd, setCatalogTariffs } from '../src/llm/llm.pricing';
import { LlmService } from '../src/llm/llm.service';
import type { LlmProvider } from '../src/llm/llm.types';
import { AnthropicProvider } from '../src/llm/providers/anthropic.provider';
import { GeminiProvider } from '../src/llm/providers/gemini.provider';
import { OpenAiProvider } from '../src/llm/providers/openai.provider';
import { EVAL_TARIFFS, type EvalTariff } from './answer-reading-eval/tariffs';
import type { CacheMode } from './answer-reading-eval/reading-cache';
import {
  allRouteReaders,
  loadRouteSet,
  parseReaderMinConfidence,
} from './answer-reading-eval/route-set';
import { runEvalCommand, type EvalCommandOptions } from './answer-reading-eval/run-eval';
import type { HarnessTranscriber } from './answer-reading-eval/simulate';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const DEFAULT_ROUTES = resolve(__dirname, 'answer-reading-eval', 'routes', 'actual.json');
const DEFAULT_CACHE_DIR = resolve(REPO_ROOT, '..', 'pruebas-vlm-manuscrito', 'cache-lecturas');
const ESTIMATED_INPUT_TOKENS = 3000;
const OBSERVED_COST_MARGIN = 1.25;

const NO_DATABASE = new Proxy(
  {},
  {
    get: () => {
      throw new Error('El arnés de evaluación no usa la base de datos');
    },
  },
) as Database;

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
  --compare <informe.json>       Comparación pareada contra un informe v2 anterior
`;

const FLAGS = new Set(['dry-run', 'no-cache', 'refresh']);

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
  };
}

function tariffFor(model: string): EvalTariff {
  const tariff = EVAL_TARIFFS[model];
  if (!tariff) throw new Error(`Sin tarifa para ${model}: agrégala a tariffs.ts con su fuente`);
  return tariff;
}

class EvalModelCatalog extends LlmModelsService {
  private readonly models: Map<string, LlmModel>;

  constructor(readers: readonly ReaderSpec[]) {
    super(NO_DATABASE);
    const now = new Date().toISOString();
    this.models = new Map();
    for (const reader of readers) {
      const tariff = tariffFor(reader.model);
      if (tariff.provider !== reader.provider) {
        throw new Error(`El lector ${reader.key} pide ${reader.model} a ${reader.provider}`);
      }
      this.models.set(`${tariff.provider}:${reader.model}`, {
        id: randomUUID(),
        provider: tariff.provider,
        modelId: reader.model,
        label: reader.model,
        maxOutputTokens: tariff.maxOutputTokens,
        supportsImages: true,
        supportsStructuredOutput: true,
        supportsBatch: false,
        supportsSamplingParams: tariff.supportsSamplingParams,
        inputUsdPerMtok: tariff.inputUsdPerMtok,
        outputUsdPerMtok: tariff.outputUsdPerMtok,
        cachedInputUsdPerMtok: tariff.cachedInputUsdPerMtok,
        batchDiscount: null,
        enabled: true,
        deprecatedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  override async onModuleInit(): Promise<void> {}

  override async findModel(
    provider: LlmProviderId,
    modelId: string,
  ): Promise<LlmModel | undefined> {
    return this.models.get(`${provider}:${modelId}`);
  }

  override async findSelectableModel(
    provider: LlmProviderId,
    modelId: string,
  ): Promise<LlmModel | undefined> {
    return this.findModel(provider, modelId);
  }
}

@Module({})
class EvalLlmModule {
  static forReaders(readers: readonly ReaderSpec[]): DynamicModule {
    return {
      module: EvalLlmModule,
      providers: [
        { provide: LlmModelsService, useValue: new EvalModelCatalog(readers) },
        {
          provide: LlmConfigService,
          useFactory: (catalog: LlmModelsService) => new LlmConfigService(NO_DATABASE, catalog),
          inject: [LlmModelsService],
        },
        AnthropicProvider,
        GeminiProvider,
        OpenAiProvider,
        {
          provide: LLM_PROVIDERS,
          useFactory: (anthropic: LlmProvider, gemini: LlmProvider, openai: LlmProvider) => [
            anthropic,
            gemini,
            openai,
          ],
          inject: [AnthropicProvider, GeminiProvider, OpenAiProvider],
        },
        {
          provide: LlmService,
          useFactory: (config: LlmConfigService, providers: LlmProvider[]) =>
            new LlmService(config, providers),
          inject: [LlmConfigService, LLM_PROVIDERS],
        },
        {
          provide: LlmVisionTranscriber,
          useFactory: (llm: LlmService) => new LlmVisionTranscriber(llm),
          inject: [LlmService],
        },
      ],
      exports: [LlmVisionTranscriber],
    };
  }
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
  setCatalogTariffs(
    new Map(
      Object.entries(EVAL_TARIFFS).map(([model, tariff]) => [
        model,
        {
          inputUsdPerMtok: tariff.inputUsdPerMtok,
          outputUsdPerMtok: tariff.outputUsdPerMtok,
          cachedInputUsdPerMtok: tariff.cachedInputUsdPerMtok,
        },
      ]),
    ),
  );
  const context = options.dryRun
    ? null
    : await NestFactory.createApplicationContext(
        EvalLlmModule.forReaders(allRouteReaders(await loadRouteSet(options.routesFile))),
        { logger: ['error', 'warn'] },
      );
  try {
    const result = await runEvalCommand(options, {
      log,
      estimateCallUsd,
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
