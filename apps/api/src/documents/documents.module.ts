import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { RemedialModule } from '../remedial/remedial.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentImagesService } from './document-images.service';
import { DocumentImportService } from './document-import.service';
import { DocumentLibraryService } from './document-library.service';
import { DocumentItemsService } from './document-items.service';
import { DocumentPromotionService } from './document-promotion.service';
import { DocumentSpecificationService } from './document-specification.service';

@Module({
  imports: [FilesModule, RemedialModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentImagesService,
    DocumentImportService,
    DocumentLibraryService,
    DocumentItemsService,
    DocumentPromotionService,
    DocumentSpecificationService,
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
