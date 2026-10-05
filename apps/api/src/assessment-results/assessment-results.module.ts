import { Module } from '@nestjs/common';
import { BenchmarkingModule } from '../benchmarking/benchmarking.module';
import { CapabilityGuard } from '../common/guards/capability.guard';
import { AssessmentResultsController } from './assessment-results.controller';
import { AssessmentResultsService } from './assessment-results.service';

@Module({
  imports: [BenchmarkingModule],
  controllers: [AssessmentResultsController],
  providers: [AssessmentResultsService, CapabilityGuard],
  exports: [AssessmentResultsService],
})
export class AssessmentResultsModule {}
