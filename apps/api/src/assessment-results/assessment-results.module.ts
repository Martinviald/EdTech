import { Module } from '@nestjs/common';
import { CapabilityGuard } from '../common/guards/capability.guard';
import { AssessmentResultsController } from './assessment-results.controller';
import { AssessmentResultsService } from './assessment-results.service';

@Module({
  controllers: [AssessmentResultsController],
  providers: [AssessmentResultsService, CapabilityGuard],
  exports: [AssessmentResultsService],
})
export class AssessmentResultsModule {}
