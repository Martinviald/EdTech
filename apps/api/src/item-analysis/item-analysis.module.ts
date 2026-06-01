import { Module } from '@nestjs/common';
import { ItemAnalysisController } from './item-analysis.controller';
import { ItemAnalysisService } from './item-analysis.service';

@Module({
  controllers: [ItemAnalysisController],
  providers: [ItemAnalysisService],
  exports: [ItemAnalysisService],
})
export class ItemAnalysisModule {}
