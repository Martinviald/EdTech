import { Module } from '@nestjs/common';
import { BenchmarkingModule } from '../benchmarking/benchmarking.module';
import { ItemAnalysisController } from './item-analysis.controller';
import { ItemAnalysisService } from './item-analysis.service';

@Module({
  imports: [BenchmarkingModule],
  controllers: [ItemAnalysisController],
  providers: [ItemAnalysisService],
  exports: [ItemAnalysisService],
})
export class ItemAnalysisModule {}
