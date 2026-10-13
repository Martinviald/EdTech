import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { estimateLlmCostUsd } from '../src/llm/llm.pricing';
import type { LlmProvider, LlmStructuredRequest } from '../src/llm/llm.types';
import { AnthropicProvider } from '../src/llm/providers/anthropic.provider';
import { GeminiProvider } from '../src/llm/providers/gemini.provider';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const DEFAULT_IMAGE = resolve(REPO_ROOT, '..', 'pruebas-vlm-manuscrito', 'fotos', 'recorte-16.jpg');

loadEnv({ path: join(REPO_ROOT, '.env') });

const TRANSCRIPTION_SCHEMA = {
  type: 'object',
  properties: {
    literal: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['literal', 'confidence'],
  additionalProperties: false,
};

const TARGETS = [
  { provider: 'anthropic', model: 'claude-haiku-5-5' },
  { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
] as const;

function buildRequest(model: string, imageBase64: string): LlmStructuredRequest {
  return {
    system:
      'Transcribes exactamente lo que el estudiante escribió a mano, sin corregir ni interpretar.',
    prompt:
      'Transcribe la respuesta manuscrita del recorte. Devuelve el texto literal y tu confianza entre 0 y 1.',
    images: [{ mimeType: 'image/jpeg', data: imageBase64 }],
    jsonSchema: TRANSCRIPTION_SCHEMA,
    schemaName: 'transcription',
    propertyOrder: ['literal', 'confidence'],
    options: { model, maxTokens: 256, reasoning: 'off', timeoutMs: 30_000 },
  };
}

async function main(): Promise<void> {
  const imagePath = process.argv[2] ?? DEFAULT_IMAGE;
  const imageBase64 = readFileSync(imagePath).toString('base64');
  const providers: Record<'anthropic' | 'gemini', LlmProvider> = {
    anthropic: new AnthropicProvider(),
    gemini: new GeminiProvider(),
  };

  for (const target of TARGETS) {
    const provider = providers[target.provider];
    if (!provider.isAvailable() || !provider.completeStructured) {
      console.log(`${target.model}: proveedor no disponible`);
      continue;
    }
    const startedAt = Date.now();
    const result = await provider.completeStructured(buildRequest(target.model, imageBase64));
    const costUsd = result.usage
      ? estimateLlmCostUsd(
          target.model,
          {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            cachedInputTokens: result.usage.cachedInputTokens,
          },
          8,
        )
      : null;
    console.log(
      JSON.stringify(
        {
          model: target.model,
          providerModel: result.providerModel,
          latencyMs: Date.now() - startedAt,
          finishReason: result.finishReason,
          data: result.data,
          usage: result.usage,
          costUsd,
          providerRequestId: result.providerRequestId,
        },
        null,
        2,
      ),
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
