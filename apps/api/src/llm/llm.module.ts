import { Module } from '@nestjs/common';
import { LlmConfigService } from './llm.config';
import { LLM_PROVIDERS } from './llm.constants';
import { LlmService } from './llm.service';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GeminiProvider } from './providers/gemini.provider';

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
    LlmConfigService,
    AnthropicProvider,
    GeminiProvider,
    {
      provide: LLM_PROVIDERS,
      useFactory: (anthropic: AnthropicProvider, gemini: GeminiProvider) => [
        anthropic,
        gemini,
      ],
      inject: [AnthropicProvider, GeminiProvider],
    },
    LlmService,
  ],
  exports: [LlmService],
})
export class LlmModule {}
