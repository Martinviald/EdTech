import { Injectable } from '@nestjs/common';
import {
  remedialGuideContentSchema,
  type RemedialMaterialType,
} from '@soe/types';
import { LlmService } from '../../llm/llm.service';
import { parseModelJson } from '../prompts/curriculum-context.prompt';
import { buildGuidePrompt, GUIDE_PROMPT_VERSION } from '../prompts/guide.prompt';
import type {
  RemedialGenerationInput,
  RemedialGenerationResult,
  RemedialGenerator,
} from '../remedial.generator';

/**
 * Generador de la guía de reenseñanza (H9.2). Inyecta el contexto RAG en el
 * prompt → Gemini → JSON validado ESTRICTO con `remedialGuideContentSchema`.
 * Material genérico por OA: la caché por `inputHash` (per-tenant en S3) lo cubre.
 */
@Injectable()
export class GuideGenerator implements RemedialGenerator {
  readonly type: RemedialMaterialType = 'guide';

  constructor(private readonly llm: LlmService) {}

  async generate(
    input: RemedialGenerationInput,
  ): Promise<RemedialGenerationResult> {
    const { system, prompt } = buildGuidePrompt(input.curriculum);
    const raw = await this.llm.complete(system, prompt, input.orgId);

    const json = parseModelJson(raw);
    const result = remedialGuideContentSchema.safeParse(json);
    if (!result.success) {
      throw new Error(
        `La guía generada no cumple el schema: ${result.error.message}`,
      );
    }

    return {
      content: result.data,
      promptVersion: GUIDE_PROMPT_VERSION,
      audit: { curriculum: input.curriculum },
    };
  }
}
