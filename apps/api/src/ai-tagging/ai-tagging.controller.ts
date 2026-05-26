import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AiTaggingService } from './ai-tagging.service';

// ── Validation schemas ─────────────────────────────────────────────────
// Defined inline since the task says not to modify packages/types.
// These follow the same shape that `aiTagRequestSchema` /
// `confirmAiTagsSchema` would have in packages/types.

const aiTagRequestSchema = z.object({
  itemIds: z
    .array(z.string().uuid())
    .min(1, 'At least one item ID is required')
    .max(50, 'Maximum 50 item IDs per request'),
  curriculumId: z.string().uuid(),
});

const confirmAiTagsSchema = z.object({
  tags: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        nodeId: z.string().uuid(),
        tagType: z.enum(['primary', 'secondary']).optional(),
        confirmed: z.boolean(),
      }),
    )
    .min(1, 'At least one tag decision is required'),
});

@Controller('ai-tagging')
@UseGuards(RolesGuard)
export class AiTaggingController {
  constructor(private readonly aiTaggingService: AiTaggingService) {}

  /**
   * POST /api/ai-tagging/suggest
   *
   * Sends item content to Claude API and returns suggested taxonomy tags
   * with confidence scores. Does NOT write anything to the database.
   */
  @Post('suggest')
  @Roles('platform_admin', 'school_admin', 'academic_director', 'eval_coordinator')
  suggest(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = aiTagRequestSchema.parse(body);
    return this.aiTaggingService.suggest(dto, user);
  }

  /**
   * POST /api/ai-tagging/confirm
   *
   * Confirms or rejects AI-suggested tags. Only confirmed tags are persisted
   * to `item_taxonomy_tags` with `tagged_by = 'ai'`.
   */
  @Post('confirm')
  @Roles('platform_admin', 'school_admin', 'academic_director', 'eval_coordinator')
  confirm(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = confirmAiTagsSchema.parse(body);
    return this.aiTaggingService.confirm(dto, user);
  }
}
