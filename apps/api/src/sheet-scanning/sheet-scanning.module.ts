import { Module } from '@nestjs/common';
import { AnswerSheetsModule } from '../answer-sheets/answer-sheets.module';
import { AnswerSheetsService } from '../answer-sheets/answer-sheets.service';
import { AnswerSheetPreviewStore } from '../answer-sheets/lib/preview-store';
import { FilesModule } from '../files/files.module';
import { JobsModule } from '../jobs/jobs.module';
import { QrIdentityResolver } from './identity';
import { OMR_CLIENT } from './omr-client.types';
import { HttpOmrClient } from './omr-http.client';
import {
  ScanReviewBatchesController,
  ScanReviewMarksController,
  ScanReviewScansController,
} from './scan-review.controller';
import {
  ANSWER_SHEET_CONFIRMER,
  createAnswerSheetConfirmer,
  ScanReviewService,
} from './scan-review.service';
import { SheetLayoutService } from './sheet-layout.service';
import { SheetLayoutsController } from './sheet-layouts.controller';
import { SheetPrintRunsController } from './sheet-print-runs.controller';
import { SheetPrintService } from './sheet-print.service';
import { SheetScanBatchesController } from './sheet-scan-batches.controller';
import { SheetScanService } from './sheet-scan.service';

@Module({
  imports: [FilesModule, JobsModule, AnswerSheetsModule],
  controllers: [
    SheetLayoutsController,
    SheetPrintRunsController,
    SheetScanBatchesController,
    ScanReviewBatchesController,
    ScanReviewMarksController,
    ScanReviewScansController,
  ],
  providers: [
    SheetLayoutService,
    SheetPrintService,
    SheetScanService,
    ScanReviewService,
    QrIdentityResolver,
    { provide: OMR_CLIENT, useFactory: (): HttpOmrClient => new HttpOmrClient() },
    {
      provide: ANSWER_SHEET_CONFIRMER,
      useFactory: createAnswerSheetConfirmer,
      inject: [AnswerSheetsService, AnswerSheetPreviewStore],
    },
  ],
})
export class SheetScanningModule {}
