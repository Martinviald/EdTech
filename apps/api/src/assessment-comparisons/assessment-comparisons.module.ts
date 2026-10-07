import { Module } from '@nestjs/common';
import { AssessmentComparisonsController } from './assessment-comparisons.controller';
import { AssessmentComparisonsService } from './assessment-comparisons.service';

@Module({
  controllers: [AssessmentComparisonsController],
  providers: [AssessmentComparisonsService],
})
export class AssessmentComparisonsModule {}
