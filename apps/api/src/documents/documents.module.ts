import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentImagesService } from './document-images.service';
import { DocumentImportService } from './document-import.service';
import { DocumentItemsService } from './document-items.service';
import { DocumentPromotionService } from './document-promotion.service';
import { DocumentSpecificationService } from './document-specification.service';

@Module({
  imports: [FilesModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentImagesService,
    DocumentImportService,
    DocumentItemsService,
    DocumentPromotionService,
    DocumentSpecificationService,
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
