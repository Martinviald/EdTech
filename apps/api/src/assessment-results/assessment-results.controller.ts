import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  RESULTS_RECALCULATE_ROLES,
  RESULTS_VIEWER_ROLES,
  calculateAssessmentResultsRequestSchema,
  listAssessmentResultsQuerySchema,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { RequireCapability } from '../common/decorators/capability.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CapabilityGuard } from '../common/guards/capability.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AssessmentResultsService } from './assessment-results.service';

@Controller('assessments/:assessmentId')
@UseGuards(RolesGuard, CapabilityGuard)
export class AssessmentResultsController {
  constructor(private readonly service: AssessmentResultsService) {}

  /**
   * POST /api/assessments/:assessmentId/results/calculate
   * Recalcula assessment_results y skill_results para una evaluación. Borra los
   * resultados previos y los reinserta en batch dentro de una transacción.
   */
  @Post('results/calculate')
  @Roles(...RESULTS_RECALCULATE_ROLES)
  calculate(
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = calculateAssessmentResultsRequestSchema.parse(body ?? {});
    return this.service.calculate(user, assessmentId, dto);
  }

  /**
   * GET /api/assessments/:assessmentId/results
   * Lista paginada de assessment_results (1 fila por alumno). Filtros opcionales
   * por classGroupId y performanceLevel. Profesores ven sólo sus cursos.
   */
  @Get('results')
  @Roles(...RESULTS_VIEWER_ROLES)
  list(
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = listAssessmentResultsQuerySchema.parse(query ?? {});
    return this.service.list(user, assessmentId, dto);
  }

  /**
   * GET /api/assessments/:assessmentId/results/:studentId
   * Detalle de un alumno: su assessment_result, los skill_results por nodo y la
   * lista de respuestas item-por-item. 404 si el alumno no está en la
   * evaluación o no es visible para el caller.
   *
   * `@RequireCapability('student_detail')`: la lista item-por-item sale de
   * `responses`, que una evaluación cargada desde un informe oficial no tiene. Sin el
   * guard devolvía el nivel del alumno con `responses: []` — un detalle vacío que
   * parece "este alumno no respondió" en vez de "este dato no existe para esta
   * evaluación".
   */
  @Get('results/:studentId')
  @Roles(...RESULTS_VIEWER_ROLES)
  @RequireCapability('student_detail')
  detail(
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.getStudentDetail(user, assessmentId, studentId);
  }

  /**
   * GET /api/assessments/:assessmentId/skill-results
   * Lista paginada de skill_results joineados con taxonomy_nodes. Filtro
   * opcional por classGroupId.
   */
  @Get('skill-results')
  @Roles(...RESULTS_VIEWER_ROLES)
  skillResults(
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = listAssessmentResultsQuerySchema.parse(query ?? {});
    return this.service.listSkillResults(user, assessmentId, {
      classGroupId: dto.classGroupId,
      page: dto.page,
      limit: dto.limit,
    });
  }
}
