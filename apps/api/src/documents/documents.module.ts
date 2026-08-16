import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentImportService } from './document-import.service';
import { DocumentItemsService } from './document-items.service';
import { DocumentPromotionService } from './document-promotion.service';
import { DocumentSpecificationService } from './document-specification.service';

@Module({
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentImportService,
    DocumentItemsService,
    DocumentPromotionService,
    DocumentSpecificationService,
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
