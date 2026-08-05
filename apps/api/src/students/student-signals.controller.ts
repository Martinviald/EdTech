import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RESULTS_VIEWER_ROLES, studentSignalsQuerySchema } from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { StudentSignalsService } from './student-signals.service';

/**
 * Lista de alumnos con señal (#2B · Z0): la puerta de entrada a la vista 360.
 * Misma audiencia que el panorama (`RESULTS_VIEWER_ROLES`); el scoping por curso
 * para profesores lo aplica el service. El `orgId` sale del token, nunca del query.
 */
@Controller('students')
@UseGuards(RolesGuard)
export class StudentSignalsController {
  constructor(private readonly service: StudentSignalsService) {}

  /** GET /api/students/signals — alumnos del alcance con sus señales derivadas. */
  @Get('signals')
  @Roles(...RESULTS_VIEWER_ROLES)
  getSignals(@CurrentUser() user: JwtPayload, @Query() query: unknown) {
    return this.service.getSignals(user, studentSignalsQuerySchema.parse(query ?? {}));
  }
}
