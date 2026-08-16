import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { RESULTS_VIEWER_ROLES, studentComparisonsQuerySchema } from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { StudentComparisonsService } from './student-comparisons.service';

/**
 * Comparativas 360 del estudiante (F2 · B2): el alumno, por asignatura, comparado contra
 * su curso, su nivel (grado completo) y las generaciones anteriores. Misma audiencia que
 * los dashboards de resultados (`RESULTS_VIEWER_ROLES`); el scoping por curso para
 * profesores lo aplica el service. El `orgId` sale del token, nunca del request.
 */
@Controller('students')
@UseGuards(RolesGuard)
export class StudentComparisonsController {
  constructor(private readonly service: StudentComparisonsService) {}

  /** GET /api/students/:id/comparisons — por asignatura: alumno vs curso, nivel y generaciones. */
  @Get(':id/comparisons')
  @Roles(...RESULTS_VIEWER_ROLES)
  getComparisons(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: unknown,
  ) {
    return this.service.getComparisons(user, id, studentComparisonsQuerySchema.parse(query ?? {}));
  }
}
