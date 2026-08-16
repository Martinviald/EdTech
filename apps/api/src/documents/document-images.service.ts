import { Injectable } from '@nestjs/common';
import type {
  DocumentAssetsResponse,
  DocumentImageConfirmResponse,
  DocumentImageUploadRequestDto,
  FileUploadUrlResponse,
} from '@soe/types';
import { withOrgContext } from '@soe/db';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { FilesService } from '../files/files.service';
import { DocumentsService } from './documents.service';

const DOCUMENT_IMAGE_OWNER_TYPE = 'document';
const DOCUMENT_IMAGE_PURPOSE = 'document_image';

@Injectable()
export class DocumentImagesService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly documentsService: DocumentsService,
    private readonly filesService: FilesService,
  ) {}

  async requestUpload(
    user: JwtPayload,
    documentId: string,
    dto: DocumentImageUploadRequestDto,
  ): Promise<FileUploadUrlResponse> {
    const orgId = this.documentsService.requireOrgId(user);
    await this.assertCanEdit(user, orgId, documentId);

    const { upload } = await this.filesService.createUploadIntent({
      orgId,
      createdById: user.userId,
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
      ownerType: DOCUMENT_IMAGE_OWNER_TYPE,
      ownerId: documentId,
      purpose: DOCUMENT_IMAGE_PURPOSE,
    });
    return upload;
  }

  async confirmUpload(
    user: JwtPayload,
    documentId: string,
    fileId: string,
    sizeBytes?: number | null,
  ): Promise<DocumentImageConfirmResponse> {
    const orgId = this.documentsService.requireOrgId(user);
    await this.assertCanEdit(user, orgId, documentId);

    const row = await this.filesService.confirm({
      orgId,
      fileId,
      sizeBytes: sizeBytes ?? null,
    });
    return { fileId: row.id, url: this.filesService.buildDownloadUrl(row, 'inline') ?? null };
  }

  async getAssets(user: JwtPayload, documentId: string): Promise<DocumentAssetsResponse> {
    const orgId = this.documentsService.requireOrgId(user);
    await withOrgContext(this.db, orgId, async (tx) => {
      await this.documentsService.findVisibleOrThrow(tx, orgId, user, documentId);
    });

    const { data } = await this.filesService.list(orgId, {
      ownerType: DOCUMENT_IMAGE_OWNER_TYPE,
      ownerId: documentId,
      purpose: DOCUMENT_IMAGE_PURPOSE,
      status: 'ready',
      limit: 100,
    });

    const assets: DocumentAssetsResponse = {};
    for (const row of data) {
      const url = this.filesService.buildDownloadUrl(row, 'inline');
      if (url) assets[row.id] = url;
    }
    return assets;
  }

  private async assertCanEdit(
    user: JwtPayload,
    orgId: string,
    documentId: string,
  ): Promise<void> {
    await withOrgContext(this.db, orgId, async (tx) => {
      const found = await this.documentsService.findVisibleOrThrow(tx, orgId, user, documentId);
      this.documentsService.assertOwner(found.document, user);
    });
  }
}
