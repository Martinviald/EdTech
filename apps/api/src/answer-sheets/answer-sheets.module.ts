import { Module } from '@nestjs/common';
import { AnswerSheetsController } from './answer-sheets.controller';
import { AnswerSheetsService } from './answer-sheets.service';
import { AnswerSheetPreviewStore } from './lib/preview-store';

@Module({
  controllers: [AnswerSheetsController],
  providers: [AnswerSheetsService, AnswerSheetPreviewStore],
  exports: [AnswerSheetsService],
})
export class AnswerSheetsModule {}
