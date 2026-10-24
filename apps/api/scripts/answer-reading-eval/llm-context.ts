import { randomUUID } from 'node:crypto';
import { Module, type DynamicModule } from '@nestjs/common';
import type { Database } from '@soe/db';
import type { LlmModel, LlmProviderId, ReaderSpec } from '@soe/types';
import { LlmVisionTranscriber } from '../../src/answer-reading/transcribers/llm-vision-transcriber';
import { LlmConfigService } from '../../src/llm/llm.config';
import { LLM_PROVIDERS } from '../../src/llm/llm.constants';
import { LlmModelsService } from '../../src/llm/llm-models.service';
import { setCatalogTariffs } from '../../src/llm/llm.pricing';
import { LlmService } from '../../src/llm/llm.service';
import type { LlmProvider } from '../../src/llm/llm.types';
import { AnthropicProvider } from '../../src/llm/providers/anthropic.provider';
import { GeminiProvider } from '../../src/llm/providers/gemini.provider';
import { OpenAiProvider } from '../../src/llm/providers/openai.provider';
import { EVAL_TARIFFS, type EvalTariff } from './tariffs';

const NO_DATABASE = new Proxy(
  {},
  {
    get: () => {
      throw new Error('El arnés de evaluación no usa la base de datos');
    },
  },
) as Database;

export function applyEvalTariffs(): void {
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
export class EvalLlmModule {
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
