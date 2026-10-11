import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Module, type DynamicModule, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config as loadEnv } from 'dotenv';
import type {
  EvalTranscriber,
  EvalTranscriptionRequest,
  TranscriptionResult,
} from '@soe/answer-reading';
import type { Database } from '@soe/db';
import type {
  LlmModel,
  LlmProviderId,
  ReaderSpec,
  ReadingUsage,
  TranscriptionStatus,
  VisionProvider,
} from '@soe/types';
import { LlmConfigService } from '../src/llm/llm.config';
import { LLM_PROVIDERS } from '../src/llm/llm.constants';
import { LlmModelsService } from '../src/llm/llm-models.service';
import { estimateLlmCostUsd } from '../src/llm/llm.pricing';
import { LlmService } from '../src/llm/llm.service';
import type { LlmProvider, LlmStructuredResult } from '../src/llm/llm.types';
import { AnthropicProvider } from '../src/llm/providers/anthropic.provider';
import { GeminiProvider } from '../src/llm/providers/gemini.provider';
import { OpenAiProvider } from '../src/llm/providers/openai.provider';
import { loadRoute, routeReaders, runEvalCommand } from './answer-reading-eval/run-eval';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const DEFAULT_ROUTE = resolve(__dirname, 'answer-reading-eval', 'routes', 'default.json');
const LLM_TRANSCRIBER_ID = 'llm';
const ESTIMATED_INPUT_TOKENS = 3000;
const OBSERVED_COST_MARGIN = 1.25;
const STRUCTURED_SCHEMA_NAME = 'transcription';

const LLM_PROVIDER_BY_VISION: Partial<Record<VisionProvider, LlmProviderId>> = {
  anthropic: 'anthropic',
  gemini: 'gemini',
  openai: 'openai',
};

const NO_DATABASE = new Proxy(
  {},
  {
    get: () => {
      throw new Error('El arnés de evaluación no usa la base de datos');
    },
  },
) as Database;

interface CliOptions {
  datasetDir: string;
  routeFile: string;
  repetitions: number;
  concurrency: number;
  budgetUsd: number | null;
  outDir: string;
  dryRun: boolean;
  compareFile: string | null;
}

const HELP = `Uso: pnpm --filter @soe/api answer-reading:eval --dataset <dir> [opciones]

  --dataset <dir>          Directorio con manifest.json e imágenes (obligatorio)
  --route <archivo.json>   ReadingRoute a evaluar (por defecto routes/default.json)
  --repetitions <n>        Repeticiones por muestra (por defecto 1)
  --budget-usd <x>         Tope de gasto; obligatorio sin --dry-run
  --concurrency <n>        Muestras en paralelo (por defecto 2)
  --out <dir>              Carpeta de salida (por defecto una carpeta temporal)
  --dry-run                Usa el transcriptor falso: no llama a ninguna API
  --compare <informe.json> Compara contra un informe anterior
`;

function numberOption(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} debe ser un número > 0`);
  return parsed;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(HELP);
      process.exit(0);
    }
    if (arg === '--dry-run') {
      flags.add('dry-run');
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Argumento inesperado: ${arg}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Falta el valor de ${arg}`);
    values.set(arg.slice(2), value);
    index += 1;
  }
  const dataset = values.get('dataset');
  if (!dataset) throw new Error('Falta --dataset');
  const dryRun = flags.has('dry-run');
  const budget = values.get('budget-usd');
  if (!dryRun && budget === undefined) {
    throw new Error('Sin --dry-run debes fijar --budget-usd para no gastar sin tope');
  }
  return {
    datasetDir: resolve(dataset),
    routeFile: resolve(values.get('route') ?? DEFAULT_ROUTE),
    repetitions: Math.floor(numberOption(values.get('repetitions'), '--repetitions', 1)),
    concurrency: Math.floor(numberOption(values.get('concurrency'), '--concurrency', 2)),
    budgetUsd: budget === undefined ? null : numberOption(budget, '--budget-usd', 0),
    outDir: resolve(
      values.get('out') ??
        join(tmpdir(), `answer-reading-eval-${new Date().toISOString().replace(/[:.]/g, '-')}`),
    ),
    dryRun,
    compareFile: values.get('compare') ? resolve(values.get('compare') ?? '') : null,
  };
}

function tariffPerMtok(model: string, kind: 'input' | 'output'): number | null {
  const usage =
    kind === 'input'
      ? { inputTokens: 1_000_000, outputTokens: 0 }
      : { inputTokens: 0, outputTokens: 1_000_000 };
  const cost = estimateLlmCostUsd(model, usage);
  return cost === null ? null : Number(cost);
}

class EvalModelCatalog extends LlmModelsService {
  private readonly models: Map<string, LlmModel>;

  constructor(readers: readonly ReaderSpec[]) {
    super(NO_DATABASE);
    const now = new Date().toISOString();
    this.models = new Map();
    for (const reader of readers) {
      const provider = LLM_PROVIDER_BY_VISION[reader.provider];
      const input = tariffPerMtok(reader.model, 'input');
      const output = tariffPerMtok(reader.model, 'output');
      if (!provider || input === null || output === null) {
        throw new Error(
          `Sin tarifa ni proveedor LLM para el lector ${reader.key} (${reader.model})`,
        );
      }
      this.models.set(`${provider}:${reader.model}`, {
        id: randomUUID(),
        provider,
        modelId: reader.model,
        label: reader.model,
        maxOutputTokens: reader.params.maxOutputTokens,
        supportsImages: true,
        supportsStructuredOutput: true,
        supportsBatch: false,
        supportsSamplingParams: false,
        inputUsdPerMtok: input,
        outputUsdPerMtok: output,
        cachedInputUsdPerMtok: null,
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
      ],
      exports: [LlmService],
    };
  }
}

class LlmEvalTranscriber implements EvalTranscriber {
  readonly id = LLM_TRANSCRIBER_ID;

  constructor(
    private readonly llm: LlmService,
    private readonly providers: ReadonlyMap<LlmProviderId, LlmProvider>,
  ) {}

  supports(reader: ReaderSpec): boolean {
    const provider = LLM_PROVIDER_BY_VISION[reader.provider];
    return (
      reader.transcriberId === this.id &&
      provider !== undefined &&
      (this.providers.get(provider)?.isAvailable() ?? false)
    );
  }

  async transcribe(request: EvalTranscriptionRequest): Promise<TranscriptionResult> {
    const { reader } = request;
    const provider = LLM_PROVIDER_BY_VISION[reader.provider];
    const startedAt = performance.now();
    if (!provider) return this.failure(reader, 'error', 'unsupported_provider', startedAt);
    try {
      const result = await this.llm.completeStructured(
        {
          system: request.prompt.system,
          prompt: request.prompt.user,
          images: [{ mimeType: request.image.mimeType, data: request.image.base64 }],
          jsonSchema: request.outputJsonSchema.schema,
          schemaName: STRUCTURED_SCHEMA_NAME,
          propertyOrder: [...request.outputJsonSchema.propertyOrder],
          reasoning: reader.params.reasoning,
          maxTokens: reader.params.maxOutputTokens,
          timeoutMs: reader.params.timeoutMs,
          target: { provider, model: reader.model },
          ...(reader.params.mediaResolution
            ? { mediaResolution: reader.params.mediaResolution }
            : {}),
        },
        null,
        'answer_transcription',
      );
      return this.toTranscription(request, result, startedAt);
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 200) : 'error';
      const status: TranscriptionStatus = /timeout|timed out|abort/i.test(code)
        ? 'timeout'
        : 'error';
      return this.failure(reader, status, code, startedAt);
    }
  }

  private toTranscription(
    request: EvalTranscriptionRequest,
    result: LlmStructuredResult,
    startedAt: number,
  ): TranscriptionResult {
    const usage: ReadingUsage | null = result.usage ? { ...result.usage } : null;
    const cost = estimateLlmCostUsd(result.model, result.usage, 8);
    const base = {
      rawText: result.rawText,
      providerModel: result.model,
      usage,
      costUsd: cost === null ? null : Number(cost),
      latencyMs: Math.round(performance.now() - startedAt),
    };
    if (result.finishReason === 'max_tokens') {
      return { ...base, status: 'truncated', output: null, errorCode: 'max_tokens' };
    }
    if (result.finishReason === 'refusal' || result.finishReason === 'safety') {
      return { ...base, status: 'refused', output: null, errorCode: result.finishReason };
    }
    const parsed = request.outputSchema.safeParse(result.data);
    if (result.data === null || !parsed.success) {
      return { ...base, status: 'invalid_output', output: null, errorCode: 'schema' };
    }
    return { ...base, status: 'ok', output: parsed.data, errorCode: null };
  }

  private failure(
    reader: ReaderSpec,
    status: TranscriptionStatus,
    errorCode: string,
    startedAt: number,
  ): TranscriptionResult {
    return {
      status,
      output: null,
      rawText: null,
      providerModel: reader.model,
      usage: null,
      costUsd: null,
      latencyMs: Math.round(performance.now() - startedAt),
      errorCode,
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

async function realTranscribers(
  routeFile: string,
): Promise<{ context: INestApplicationContext; transcriber: LlmEvalTranscriber }> {
  const route = await loadRoute(routeFile);
  const context = await NestFactory.createApplicationContext(
    EvalLlmModule.forReaders(routeReaders(route)),
    { logger: ['error', 'warn'] },
  );
  const providers = new Map<LlmProviderId, LlmProvider>([
    ['anthropic', context.get(AnthropicProvider)],
    ['gemini', context.get(GeminiProvider)],
    ['openai', context.get(OpenAiProvider)],
  ]);
  return { context, transcriber: new LlmEvalTranscriber(context.get(LlmService), providers) };
}

async function main(): Promise<void> {
  loadEnv({ path: join(REPO_ROOT, '.env') });
  const options = parseArgs(process.argv.slice(2));
  const log = (message: string) => process.stderr.write(`${message}\n`);
  const real = options.dryRun ? null : await realTranscribers(options.routeFile);
  try {
    const transcriber = real?.transcriber;
    const result = await runEvalCommand(options, {
      log,
      estimateCallUsd,
      ...(transcriber
        ? {
            transcriberFor: (reader: ReaderSpec) =>
              transcriber.supports(reader) ? transcriber : null,
          }
        : {}),
    });
    const { metrics } = result.report;
    log(
      `Precisión autoaceptada ${metrics.autoAcceptedPrecision.count}/${metrics.autoAcceptedPrecision.total} · autoaceptación ${metrics.autoAccepted.count}/${metrics.autoAccepted.total} · costo US$${metrics.cost.totalUsd.toFixed(5)}`,
    );
    for (const file of result.files) log(`Escrito: ${file}`);
  } finally {
    await real?.context.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
