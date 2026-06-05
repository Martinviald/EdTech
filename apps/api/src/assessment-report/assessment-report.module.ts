import { Module } from '@nestjs/common';
import { AssessmentReportController } from './assessment-report.controller';
import { AssessmentReportService } from './assessment-report.service';

@Module({
  controllers: [AssessmentReportController],
  providers: [AssessmentReportService],
  exports: [AssessmentReportService],
})
export class AssessmentReportModule {}
