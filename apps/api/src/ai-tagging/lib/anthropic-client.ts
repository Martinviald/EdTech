import { Injectable, Logger } from '@nestjs/common';

/**
 * Lightweight wrapper around the Anthropic SDK.
 *
 * NOTE: `@anthropic-ai/sdk` must be installed (`pnpm add @anthropic-ai/sdk`).
 * If the package is missing at compile time, the import will fail — this is
 * expected until the integration phase runs `pnpm install`.
 */

// Dynamic import type to avoid hard crash if the SDK package isn't installed yet.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type Anthropic = import('@anthropic-ai/sdk').default;

@Injectable()
export class AnthropicClient {
  private readonly logger = new Logger(AnthropicClient.name);
  private client: Anthropic | null = null;

  constructor() {
    this.initClient();
  }

  private initClient(): void {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set — AI tagging will return 503 on suggest calls',
      );
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const AnthropicSdk = require('@anthropic-ai/sdk') as {
        default: new (opts: { apiKey: string }) => Anthropic;
      };
      const Constructor = AnthropicSdk.default ?? AnthropicSdk;
      this.client = new (Constructor as new (opts: { apiKey: string }) => Anthropic)({
        apiKey,
      });
    } catch (err) {
      this.logger.error(
        'Failed to initialize Anthropic SDK. Ensure @anthropic-ai/sdk is installed.',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    if (!this.client) {
      throw new Error('Anthropic client is not available');
    }

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = response.content.find(
      (b: { type: string }) => b.type === 'text',
    );
    return (textBlock as { type: 'text'; text: string } | undefined)?.text ?? '';
  }
}
