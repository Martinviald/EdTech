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
  customizeDocumentItemSchema,
  documentImageConfirmRequestSchema,
  documentImageUploadRequestSchema,
  documentListQuerySchema,
  updateDocumentSchema,
  DOCUMENT_EDITOR_ROLES,
  DOCUMENT_VIEWER_ROLES,
  type DocumentAssetsResponse,
  type DocumentImageConfirmResponse,
  type DocumentListResponse,
  type DocumentModel,
  type DocumentSpecificationResponse,
  type FileUploadUrlResponse,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { DocumentsService } from './documents.service';
import { DocumentImagesService } from './document-images.service';
import { DocumentImportService } from './document-import.service';
import { DocumentItemsService } from './document-items.service';
import { DocumentPromotionService } from './document-promotion.service';
import { DocumentSpecificationService } from './document-specification.service';

@Controller('documents')
@UseGuards(RolesGuard)
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly imagesService: DocumentImagesService,
    private readonly importService: DocumentImportService,
    private readonly itemsService: DocumentItemsService,
    private readonly promotionService: DocumentPromotionService,
    private readonly specificationService: DocumentSpecificationService,
  ) {}

  @Post('from-remedial/:remedialId')
  @Roles(...DOCUMENT_EDITOR_ROLES)
  fromRemedial(
    @Param('remedialId') remedialId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<DocumentModel> {
    return this.importService.fromRemedial(user, remedialId);
  }

  @Post('from-instrument/:instrumentId')
  @Roles(...DOCUMENT_EDITOR_ROLES)
  fromInstrument(
    @Param('instrumentId') instrumentId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<DocumentModel> {
    return this.importService.fromInstrument(user, instrumentId);
  }

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

  @Get(':id/specification')
  @Roles(...DOCUMENT_VIEWER_ROLES)
  specification(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<DocumentSpecificationResponse> {
    return this.specificationService.getSpecification(user, id);
  }

  @Post(':id/items/:itemId/customize')
  @Roles(...DOCUMENT_EDITOR_ROLES)
  customizeItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<DocumentModel> {
    const dto = customizeDocumentItemSchema.parse(body);
    return this.itemsService.customize(user, id, itemId, dto);
  }

  @Post(':id/promote-to-instrument')
  @Roles(...DOCUMENT_EDITOR_ROLES)
  promoteToInstrument(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<DocumentModel> {
    return this.promotionService.promoteToInstrument(user, id);
  }

  @Post(':id/images/upload-url')
  @Roles(...DOCUMENT_EDITOR_ROLES)
  requestImageUpload(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<FileUploadUrlResponse> {
    const dto = documentImageUploadRequestSchema.parse(body);
    return this.imagesService.requestUpload(user, id, dto);
  }

  @Post(':id/images/:fileId/confirm')
  @Roles(...DOCUMENT_EDITOR_ROLES)
  confirmImageUpload(
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<DocumentImageConfirmResponse> {
    const dto = documentImageConfirmRequestSchema.parse(body);
    return this.imagesService.confirmUpload(user, id, fileId, dto.sizeBytes);
  }

  @Get(':id/assets')
  @Roles(...DOCUMENT_VIEWER_ROLES)
  assets(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<DocumentAssetsResponse> {
    return this.imagesService.getAssets(user, id);
  }
}
