import { Module } from '@nestjs/common';
import { OfficialReportsController } from './official-reports.controller';
import { ReportSupportService } from './report-support.service';
import { CourseReportService } from './course-report.service';
import { EstablishmentReportService } from './establishment-report.service';
import { StudentReportService } from './student-report.service';

/**
 * Informes oficiales (TKT-24/25/26) — capa de datos + contrato. Un service por
 * informe (SRP) + un service de soporte compartido (scoping por rol + metadatos).
 */
@Module({
  controllers: [OfficialReportsController],
  providers: [
    ReportSupportService,
    CourseReportService,
    EstablishmentReportService,
    StudentReportService,
  ],
  exports: [CourseReportService, EstablishmentReportService, StudentReportService],
})
export class OfficialReportsModule {}
