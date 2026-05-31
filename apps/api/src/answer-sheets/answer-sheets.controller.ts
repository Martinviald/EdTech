import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseFilePipeBuilder,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ANSWER_SHEET_FORMATS,
  ANSWER_SHEET_IMPORT_ROLES,
  answerSheetColumnMappingSchema,
  answerSheetConfirmRequestSchema,
  answerSheetUploadMetadataSchema,
  type AnswerSheetFormat,
} from '@soe/types';
import { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AnswerSheetsService } from './answer-sheets.service';

type UploadedAnswerSheet = {
  buffer: Buffer;
  originalname: string;
};

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const csvOrXlsxFilePipe = new ParseFilePipeBuilder()
  .addMaxSizeValidator({
    maxSize: MAX_FILE_BYTES,
    message: 'El archivo excede el tamaño máximo (10 MB)',
  })
  .build({ fileIsRequired: true });

const previewBodySchema = z.object({
  previewToken: z.string().uuid(),
});

@Controller('answer-sheets')
@UseGuards(RolesGuard)
@Roles(...ANSWER_SHEET_IMPORT_ROLES)
export class AnswerSheetsController {
  constructor(private readonly service: AnswerSheetsService) {}

  /**
   * POST /answer-sheets/upload
   * Multipart: `file` (CSV/Excel) + metadata fields.
   * Devuelve un `previewToken` válido por 30 min.
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser() user: JwtPayload,
    @UploadedFile(csvOrXlsxFilePipe) file: UploadedAnswerSheet,
    @Body() body: Record<string, unknown>,
  ) {
    // El columnMapping llega como JSON string si viene en multipart; lo
    // parseamos antes de validar el metadata schema.
    const rawMapping = body.columnMapping;
    let parsedMapping: unknown = rawMapping;
    if (typeof rawMapping === 'string' && rawMapping.length > 0) {
      try {
        parsedMapping = JSON.parse(rawMapping);
      } catch {
        throw new BadRequestException('columnMapping debe ser un JSON válido');
      }
    }

    const validated = answerSheetUploadMetadataSchema.safeParse({
      format: body.format,
      instrumentId: body.instrumentId,
      classGroupId: body.classGroupId || undefined,
      assessmentId: body.assessmentId || undefined,
      assessmentName: body.assessmentName || undefined,
      columnMapping:
        parsedMapping && parsedMapping !== ''
          ? answerSheetColumnMappingSchema.parse(parsedMapping)
          : undefined,
    });
    if (!validated.success) {
      throw new BadRequestException(validated.error.flatten());
    }

    return this.service.upload(user, file, validated.data);
  }

  /**
   * POST /answer-sheets/preview
   * Devuelve la previsualización (matched students + errores + summary).
   */
  @Post('preview')
  async preview(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    const parsed = previewBodySchema.parse(body);
    return this.service.preview(user, parsed.previewToken);
  }

  /**
   * POST /answer-sheets/confirm
   * Persiste responses + results + import_job en una transacción.
   */
  @Post('confirm')
  async confirm(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    const parsed = answerSheetConfirmRequestSchema.parse(body);
    return this.service.confirm(user, parsed);
  }

  /** GET /answer-sheets/jobs/:jobId — estado de un import_job. */
  @Get('jobs/:jobId')
  async getJob(@CurrentUser() user: JwtPayload, @Param('jobId') jobId: string) {
    z.string().uuid().parse(jobId);
    return this.service.getJob(user, jobId);
  }

  /** GET /answer-sheets/templates — lista los formatos soportados. */
  @Get('templates')
  listTemplates() {
    return this.service.listTemplates();
  }

  /** GET /answer-sheets/templates/:format — descarga descriptor + ejemplo. */
  @Get('templates/:format')
  getTemplate(@Param('format') format: string) {
    if (!ANSWER_SHEET_FORMATS.includes(format as AnswerSheetFormat)) {
      throw new NotFoundException(`Formato desconocido: ${format}`);
    }
    const template = this.service.getTemplate(format as AnswerSheetFormat);
    if (!template) throw new NotFoundException(`Formato desconocido: ${format}`);
    return template;
  }
}
