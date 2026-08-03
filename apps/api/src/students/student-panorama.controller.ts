import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { RESULTS_VIEWER_ROLES } from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { StudentPanoramaService } from './student-panorama.service';

/**
 * Vista 360 del estudiante (T2-20): panorama consolidado de UN alumno a través de
 * sus evaluaciones. Misma audiencia que los dashboards de resultados
 * (`RESULTS_VIEWER_ROLES`); el scoping por curso para profesores lo aplica el
 * service (un profesor sólo ve alumnos de sus cursos asignados). El `orgId` sale
 * del token, nunca del request.
 */
@Controller('students')
@UseGuards(RolesGuard)
export class StudentPanoramaController {
  constructor(private readonly service: StudentPanoramaService) {}

  /** GET /api/students/:id/panorama — consolidado por evaluación, habilidad/eje y nivel. */
  @Get(':id/panorama')
  @Roles(...RESULTS_VIEWER_ROLES)
  getPanorama(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getPanorama(user, id);
  }
}
