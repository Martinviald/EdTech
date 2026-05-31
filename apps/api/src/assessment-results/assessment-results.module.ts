import { Module } from '@nestjs/common';
import { AssessmentResultsController } from './assessment-results.controller';
import { AssessmentResultsService } from './assessment-results.service';

@Module({
  controllers: [AssessmentResultsController],
  providers: [AssessmentResultsService],
  exports: [AssessmentResultsService],
})
export class AssessmentResultsModule {}
