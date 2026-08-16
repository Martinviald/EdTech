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
import {
  createDocumentSchema,
  documentListQuerySchema,
  updateDocumentSchema,
  DOCUMENT_EDITOR_ROLES,
  DOCUMENT_VIEWER_ROLES,
  type DocumentListResponse,
  type DocumentModel,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { DocumentsService } from './documents.service';

@Controller('documents')
@UseGuards(RolesGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  @Roles(...DOCUMENT_VIEWER_ROLES)
  list(
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<DocumentListResponse> {
    const dto = documentListQuerySchema.parse(query);
    return this.documentsService.list(user, dto);
  }

  @Post()
  @Roles(...DOCUMENT_EDITOR_ROLES)
  create(@Body() body: unknown, @CurrentUser() user: JwtPayload): Promise<DocumentModel> {
    const dto = createDocumentSchema.parse(body);
    return this.documentsService.create(user, dto);
  }

  @Get(':id')
  @Roles(...DOCUMENT_VIEWER_ROLES)
  get(@Param('id') id: string, @CurrentUser() user: JwtPayload): Promise<DocumentModel> {
    return this.documentsService.get(user, id);
  }

  @Patch(':id')
  @Roles(...DOCUMENT_EDITOR_ROLES)
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<DocumentModel> {
    const dto = updateDocumentSchema.parse(body);
    return this.documentsService.update(user, id, dto);
  }

  @Delete(':id')
  @Roles(...DOCUMENT_EDITOR_ROLES)
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload): Promise<void> {
    await this.documentsService.remove(user, id);
  }

  @Post(':id/duplicate')
  @Roles(...DOCUMENT_EDITOR_ROLES)
  duplicate(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<DocumentModel> {
    return this.documentsService.duplicate(user, id);
  }
}
