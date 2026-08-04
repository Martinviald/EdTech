import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { z, type ZodError } from 'zod';
import { TAXONOMY_ROLES } from '@soe/types';
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
  // Claves de alternativa configurables: hasta 5 chars (alinea con el schema canónico
  // `multipleChoiceContentSchema.alternatives[].key`). Soporta A–E (PAES) y V/F sin
  // capar a un único carácter. La validación del set válido la hace el parser (#4).
  correctKey: z.string().min(1).max(5),
  alternatives: z.array(
    z.object({
      key: z.string().min(1).max(5),
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
  taxonomyId: z.string().uuid(),
  isOfficial: z.boolean().optional().default(false),
});

const diaIngestionRequestSchema = z.object({
  data: diaRawPayloadSchema,
  metadata: diaIngestionMetadataSchema,
});

function parseDiaIngestionBody(body: unknown) {
  const result = diaIngestionRequestSchema.safeParse(body);
  if (result.success) return result.data;
  throw new BadRequestException({
    message: humanizeDiaZodError(result.error),
    errors: result.error.issues,
  });
}

function humanizeDiaZodError(error: ZodError): string {
  const first = error.issues[0];
  if (!first) return 'El archivo no es válido.';

  const path = first.path.join('.');
  if (path === 'data.items' && first.code === 'too_small') {
    return 'El archivo no contiene preguntas. Verifica que el JSON tenga al menos una pregunta en `items`.';
  }
  if (path.startsWith('data.instrument.')) {
    const field = path.replace('data.instrument.', '');
    return `Falta o es inválido el campo "${field}" en la metadata del instrumento.`;
  }
  if (path.startsWith('data.items.')) {
    return `Hay un ítem inválido en el archivo (${path}): ${first.message}`;
  }
  if (path.startsWith('metadata.')) {
    return `Metadata inválida (${path.replace('metadata.', '')}): ${first.message}`;
  }
  return first.message;
}

@Controller('dia-ingestion')
@UseGuards(RolesGuard)
@Roles(...TAXONOMY_ROLES)
export class DiaIngestionController {
  constructor(private readonly diaIngestionService: DiaIngestionService) {}

  /**
   * POST /dia-ingestion/preview
   * Parse and validate a DIA payload without persisting.
   * Returns a preview with validation errors and taxonomy matches.
   */
  @Post('preview')
  async preview(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const { data, metadata } = parseDiaIngestionBody(body);
    return this.diaIngestionService.preview(data, metadata, user);
  }

  /**
   * POST /dia-ingestion/confirm
   * Create instrument + items + taxonomy tags atomically in a transaction.
   * Must pass the same payload that was previewed.
   */
  @Post('confirm')
  async confirm(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const { data, metadata } = parseDiaIngestionBody(body);
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
