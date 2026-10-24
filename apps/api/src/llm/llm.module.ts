import { Module } from '@nestjs/common';
import { LlmAgentService } from './llm-agent.service';
import { LlmConfigService } from './llm.config';
import { LLM_PROVIDERS } from './llm.constants';
import { LlmService } from './llm.service';
import { LlmModelsController } from './llm-models.controller';
import { LlmModelsService } from './llm-models.service';
import { LlmSettingsController } from './llm-settings.controller';
import { LlmSettingsService } from './llm-settings.service';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { OpenAiProvider } from './providers/openai.provider';

/**
 * Módulo LLM provider-agnóstico.
 *
 * Para añadir un nuevo proveedor (OpenAI, DeepSeek, …):
 *  1. Implementar `XxxProvider implements LlmProvider` en `providers/`.
 *  2. Declararlo en `providers` y agregarlo a la factory de `LLM_PROVIDERS`.
 *  3. Completar/ajustar su entrada en `LLM_PROVIDER_DEFAULTS`.
 * No hay que tocar `LlmService` ni los consumidores.
 */
@Module({
  providers: [
    LlmModelsService,
    LlmConfigService,
    AnthropicProvider,
    GeminiProvider,
    OpenAiProvider,
    {
      provide: LLM_PROVIDERS,
      useFactory: (
        anthropic: AnthropicProvider,
        gemini: GeminiProvider,
        openai: OpenAiProvider,
      ) => [anthropic, gemini, openai],
      inject: [AnthropicProvider, GeminiProvider, OpenAiProvider],
    },
    LlmService,
    LlmAgentService,
    LlmSettingsService,
  ],
  controllers: [LlmSettingsController, LlmModelsController],
  exports: [LlmService, LlmAgentService, LlmConfigService, LlmModelsService],
})
export class LlmModule {}
