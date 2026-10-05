import { Module } from '@nestjs/common';
import { BenchmarkingModule } from '../benchmarking/benchmarking.module';
import { AnswerSheetsController } from './answer-sheets.controller';
import { AnswerSheetsService } from './answer-sheets.service';
import { AnswerSheetPreviewStore } from './lib/preview-store';

@Module({
  imports: [BenchmarkingModule],
  controllers: [AnswerSheetsController],
  providers: [AnswerSheetsService, AnswerSheetPreviewStore],
  exports: [AnswerSheetsService, AnswerSheetPreviewStore],
})
export class AnswerSheetsModule {}
