import { Module } from '@nestjs/common';
import { AssessmentResultsModule } from '../assessment-results/assessment-results.module';
import { PerformanceBandsController } from './performance-bands.controller';
import { PerformanceBandsService } from './performance-bands.service';

@Module({
  imports: [AssessmentResultsModule],
  controllers: [PerformanceBandsController],
  providers: [PerformanceBandsService],
  exports: [PerformanceBandsService],
})
export class PerformanceBandsModule {}
