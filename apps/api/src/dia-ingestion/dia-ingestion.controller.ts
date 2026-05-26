import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CURRICULUM_ROLES } from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { DiaIngestionService } from './dia-ingestion.service';

/**
 * Validation schema for the DIA raw item payload.
 */
const diaRawItemSchema = z.object({
  position: z.number().int().positive(),
  correctKey: z.string().min(1).max(1),
  alternatives: z.array(
    z.object({
      key: z.string().min(1).max(1),
      text: z.string().optional(),
    }),
  ).min(2),
  skill: z.string().min(1),
  oa: z.string().optional(),
  contentAxis: z.string().optional(),
  stem: z.string().optional(),
});

const diaRawPayloadSchema = z.object({
  instrument: z.object({
    name: z.string().min(1),
    subject: z.string().min(1),
    grade: z.string().min(1),
    year: z.number().int().min(2000).max(2100),
    applicationPeriod: z.string().min(1),
  }),
  items: z.array(diaRawItemSchema).min(1),
});

const diaIngestionMetadataSchema = z.object({
  curriculumId: z.string().uuid(),
  isOfficial: z.boolean().optional().default(false),
});

const diaIngestionRequestSchema = z.object({
  data: diaRawPayloadSchema,
  metadata: diaIngestionMetadataSchema,
});

@Controller('dia-ingestion')
@UseGuards(RolesGuard)
@Roles(...CURRICULUM_ROLES)
export class DiaIngestionController {
  constructor(private readonly diaIngestionService: DiaIngestionService) {}

  /**
   * POST /dia-ingestion/preview
   * Parse and validate a DIA payload without persisting.
   * Returns a preview with validation errors and taxonomy matches.
   */
  @Post('preview')
  async preview(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const { data, metadata } = diaIngestionRequestSchema.parse(body);
    return this.diaIngestionService.preview(data, metadata, user);
  }

  /**
   * POST /dia-ingestion/confirm
   * Create instrument + items + taxonomy tags atomically in a transaction.
   * Must pass the same payload that was previewed.
   */
  @Post('confirm')
  async confirm(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const { data, metadata } = diaIngestionRequestSchema.parse(body);
    return this.diaIngestionService.confirm(data, metadata, user);
  }

  /**
   * GET /dia-ingestion/instruments
   * List DIA instruments visible to the current user (type='dia').
   * Shows both official (orgId=null) and user's org instruments.
   */
  @Get('instruments')
  async listInstruments(@CurrentUser() user: JwtPayload) {
    return this.diaIngestionService.listInstruments(user);
  }
}
