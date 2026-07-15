import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ANSWER_SHEET_IMPORT_ROLES,
  officialReportImportConfirmRequestSchema,
  officialReportImportPreviewRequestSchema,
  officialReportImportUploadMetadataSchema,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { OfficialReportImportService } from './official-report-import.service';

type UploadedReport = {
  buffer: Buffer;
  originalname: string;
};

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB — un informe en JSON pesa unos pocos KB.

/**
 * Cargar un informe oficial es la misma operación que cargar una hoja de respuestas
 * (ingresar resultados de una evaluación rendida), así que reusa
 * `ANSWER_SHEET_IMPORT_ROLES` de `access-policies.ts` en vez de declarar una lista
 * inline (CLAUDE.md §14).
 */
@Controller('official-report-import')
@UseGuards(RolesGuard)
@Roles(...ANSWER_SHEET_IMPORT_ROLES)
export class OfficialReportImportController {
  constructor(private readonly service: OfficialReportImportService) {}

  /**
   * POST /official-report-import/upload
   * Multipart: `file` (JSON del informe extraído del PDF) + instrumentId/classGroupId.
   * Devuelve un `previewToken` válido por 30 min.
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: UploadedReport | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    if (!file) throw new BadRequestException('Falta el archivo del informe (campo "file")');
    if (file.buffer.byteLength > MAX_FILE_BYTES) {
      throw new BadRequestException('El archivo excede el tamaño máximo (5 MB)');
    }

    const validated = officialReportImportUploadMetadataSchema.safeParse({
      instrumentId: body.instrumentId,
      classGroupId: body.classGroupId,
      assessmentId: body.assessmentId || undefined,
      assessmentName: body.assessmentName || undefined,
    });
    if (!validated.success) {
      throw new BadRequestException(validated.error.flatten());
    }

    return this.service.upload(user, file, validated.data);
  }

  /**
   * POST /official-report-import/preview
   * Corre los 5 gates de integridad. No persiste nada.
   */
  @Post('preview')
  async preview(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    const parsed = officialReportImportPreviewRequestSchema.parse(body);
    return this.service.preview(user, parsed.previewToken);
  }

  /**
   * POST /official-report-import/confirm
   * Persiste read-model de cohorte + niveles aprobados + import_job en una transacción.
   */
  @Post('confirm')
  async confirm(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    const parsed = officialReportImportConfirmRequestSchema.parse(body);
    return this.service.confirm(user, parsed);
  }
}
