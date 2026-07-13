import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { FilesService } from './files.service';
import {
  createFileUploadUrlRequestSchema,
  confirmFileSchema,
  updateFileSchema,
  fileQuerySchema,
} from './dto/file.dto';

/**
 * Roles con acceso al CRUD genérico de archivos vía HTTP. `platform_admin` pasa
 * el `RolesGuard` automáticamente. La mayoría de los dominios consumen
 * `FilesService` in-process; este controller es la superficie REST reutilizable.
 */
const FILE_MANAGER_ROLES = [
  'school_admin',
  'academic_director',
  'eval_coordinator',
  'coordinator',
] as const;

@Controller('files')
@UseGuards(RolesGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  /**
   * POST /api/files/upload-url — Paso 1: registra un archivo `pending` y devuelve
   * la URL prefirmada de S3 para subirlo DIRECTO (el backend no lo recibe).
   */
  @Post('upload-url')
  @Roles(...FILE_MANAGER_ROLES)
  async createUploadUrl(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = createFileUploadUrlRequestSchema.parse(body);
    const { upload } = await this.filesService.createUploadIntent({
      orgId: user.orgId,
      createdById: user.userId,
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes ?? null,
      ownerType: dto.ownerType ?? null,
      ownerId: dto.ownerId ?? null,
      purpose: dto.purpose ?? null,
      note: dto.note ?? null,
    });
    return upload;
  }

  /** POST /api/files/:id/confirm — Paso 3: valida en S3 y marca `ready`. */
  @Post(':id/confirm')
  @Roles(...FILE_MANAGER_ROLES)
  async confirm(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = confirmFileSchema.parse(body);
    const row = await this.filesService.confirm({
      orgId: user.orgId,
      fileId: id,
      sizeBytes: dto.sizeBytes ?? null,
      note: dto.note ?? null,
    });
    return this.filesService.toModel(row, true);
  }

  /** GET /api/files — lista paginada (filtrable por owner/purpose/status). */
  @Get()
  @Roles(...FILE_MANAGER_ROLES)
  async list(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const filters = fileQuerySchema.parse(query);
    const { data, total } = await this.filesService.list(user.orgId, filters);
    return {
      data: data.map((row) => this.filesService.toModel(row)),
      total,
      page: filters.page,
      limit: filters.limit,
    };
  }

  /** GET /api/files/:id — metadata + URL de descarga prefirmada. */
  @Get(':id')
  @Roles(...FILE_MANAGER_ROLES)
  async getOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const row = await this.filesService.getById(user.orgId, id);
    return this.filesService.toModel(row, true);
  }

  /** PATCH /api/files/:id — actualiza metadata (no toca el objeto en S3). */
  @Patch(':id')
  @Roles(...FILE_MANAGER_ROLES)
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = updateFileSchema.parse(body);
    const row = await this.filesService.updateMetadata(user.orgId, id, dto);
    return this.filesService.toModel(row, true);
  }

  /** DELETE /api/files/:id — soft-delete + borrado del objeto en S3. */
  @Delete(':id')
  @Roles(...FILE_MANAGER_ROLES)
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.filesService.remove(user.orgId, id);
  }
}
