import { Module } from '@nestjs/common';
import { DiaIngestionController } from './dia-ingestion.controller';
import { DiaIngestionService } from './dia-ingestion.service';

@Module({
  controllers: [DiaIngestionController],
  providers: [DiaIngestionService],
  exports: [DiaIngestionService],
})
export class DiaIngestionModule {}
