import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { ITEM_BANK_ROLES } from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SpecTablesService } from './spec-tables.service';

// ── Local DTO schemas ─────────────────────────────────────────────────────────

const specTableLinkSchema = z.object({
  instrumentId: z.string().uuid(),
  taxonomyId: z.string().uuid(),
  fileData: z.array(z.record(z.string())).min(1),
  columnMapping: z.object({
    position: z.string().min(1),
    skill: z.string().optional(),
    oa: z.string().optional(),
    content: z.string().optional(),
    difficulty: z.string().optional(),
    correctAnswer: z.string().optional(),
  }),
});

/** Accepted MIME types for Excel / CSV uploads. */
const VALID_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/vnd.ms-excel',
];

/** Max upload size in bytes (5 MB). */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

@Controller('spec-tables')
@UseGuards(RolesGuard)
export class SpecTablesController {
  constructor(private readonly specTablesService: SpecTablesService) {}

  // ─── POST /spec-tables/upload ─────────────────────────────────────────────

  /**
   * Parses an uploaded Excel (.xlsx) or CSV file and returns a column preview.
   *
   * Multipart form data with a `file` field.
   */
  @Post('upload')
  @Roles(...ITEM_BANK_ROLES)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE },
    }),
  )
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No se proporcionó un archivo');
    }

    if (!VALID_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        'El archivo debe ser .xlsx o .csv',
      );
    }

    const parsed = this.specTablesService.parseFile(file.buffer);

    return {
      columns: parsed.columns,
      preview: parsed.rows.slice(0, 5),
      fileData: parsed.rows,
      totalRows: parsed.totalRows,
    };
  }

  // ─── POST /spec-tables/link ───────────────────────────────────────────────

  /**
   * Applies the column mapping and creates `item_taxonomy_tags` entries
   * linking each item to the corresponding taxonomy nodes.
   */
  @Post('link')
  @Roles(...ITEM_BANK_ROLES)
  async link(
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = specTableLinkSchema.parse(body);

    return this.specTablesService.linkToInstrument(
      dto.instrumentId,
      dto.fileData,
      dto.columnMapping,
      dto.taxonomyId,
      user,
    );
  }

  // ─── GET /spec-tables/:instrumentId ───────────────────────────────────────

  /**
   * Returns the linked spec-table data for an instrument
   * (items with their taxonomy tags).
   */
  @Get(':instrumentId')
  @Roles(...ITEM_BANK_ROLES)
  getSpecTable(
    @Param('instrumentId') instrumentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.specTablesService.getSpecTable(instrumentId, user);
  }
}
