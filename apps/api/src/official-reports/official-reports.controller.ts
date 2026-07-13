import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ESTABLISHMENT_REPORT_ROLES,
  OFFICIAL_REPORT_VIEWER_ROLES,
  officialCourseReportQuerySchema,
  officialEstablishmentReportQuerySchema,
  officialStudentReportQuerySchema,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CourseReportService } from './course-report.service';
import { EstablishmentReportService } from './establishment-report.service';
import { StudentReportService } from './student-report.service';

/**
 * Informes oficiales (TKT-24/25/26). Sólo capa de datos + contrato: el render /
 * PDF / layout es un stream de frontend aparte. Todo el scoping por rol y el
 * aislamiento multi-tenant (RLS) lo aplican los services. El org_id sale SIEMPRE
 * del token, nunca del query.
 */
@Controller('reports')
@UseGuards(RolesGuard)
export class OfficialReportsController {
  constructor(
    private readonly courseReport: CourseReportService,
    private readonly establishmentReport: EstablishmentReportService,
    private readonly studentReport: StudentReportService,
  ) {}

  /**
   * GET /api/reports/course  (TKT-24)
   * Informe oficial por curso × asignatura × momento: portada, resultado general,
   * ejes de habilidad, tabla de especificaciones (distribución por alternativa /
   * RC-RPC-RI-N), resultados por estudiante y preguntas reflexivas.
   */
  @Get('course')
  @Roles(...OFFICIAL_REPORT_VIEWER_ROLES)
  getCourseReport(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const dto = officialCourseReportQuerySchema.parse(query ?? {});
    return this.courseReport.getCourseReport(user, dto);
  }

  /**
   * GET /api/reports/establishment  (TKT-25)
   * Informe de establecimiento (Área Académica): niveles de logro por grado ×
   * asignatura (Tablas 1.1–1.4), comparación por sexo (1.5–1.8) y conteos (1.9).
   */
  @Get('establishment')
  @Roles(...ESTABLISHMENT_REPORT_ROLES)
  getEstablishmentReport(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const dto = officialEstablishmentReportQuerySchema.parse(query ?? {});
    return this.establishmentReport.getEstablishmentReport(user, dto);
  }

  /**
   * GET /api/reports/student  (TKT-26 — sólo generación; envío por correo diferido)
   * Informe individual del alumno para una evaluación (contiene PII: scoping por
   * curso para profesores lo aplica el service).
   */
  @Get('student')
  @Roles(...OFFICIAL_REPORT_VIEWER_ROLES)
  getStudentReport(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const dto = officialStudentReportQuerySchema.parse(query ?? {});
    return this.studentReport.getStudentReport(user, dto);
  }
}
