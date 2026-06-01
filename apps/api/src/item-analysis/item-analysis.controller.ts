import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ITEM_ANALYSIS_VIEWER_ROLES,
  assessmentListQuerySchema,
  itemMatrixQuerySchema,
  questionAnalysisQuerySchema,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ItemAnalysisService } from './item-analysis.service';

@Controller('item-analysis')
@UseGuards(RolesGuard)
export class ItemAnalysisController {
  constructor(private readonly service: ItemAnalysisService) {}

  /**
   * GET /api/item-analysis/assessments
   * Evaluaciones con resultados visibles para el usuario (scoped), para poblar el
   * selector de la tabla cruzada. Filtrable por asignatura/grado/curso/período/tipo.
   */
  @Get('assessments')
  @Roles(...ITEM_ANALYSIS_VIEWER_ROLES)
  assessments(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const dto = assessmentListQuerySchema.parse(query ?? {});
    return this.service.listAssessments(user, dto);
  }

  /**
   * GET /api/item-analysis/matrix  (H6.11)
   * Tabla cruzada alumno × pregunta para una evaluación. Devuelve las columnas
   * (preguntas con su clave correcta, habilidad/contenido y tasa de acierto) y
   * los alumnos paginados con su respuesta a cada pregunta.
   */
  @Get('matrix')
  @Roles(...ITEM_ANALYSIS_VIEWER_ROLES)
  matrix(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const dto = itemMatrixQuerySchema.parse(query ?? {});
    return this.service.getMatrix(user, dto);
  }

  /**
   * GET /api/item-analysis/questions/:itemId  (H6.12)
   * Distribución de respuestas y análisis de distractores de una pregunta.
   */
  @Get('questions/:itemId')
  @Roles(...ITEM_ANALYSIS_VIEWER_ROLES)
  question(
    @Param('itemId') itemId: string,
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = questionAnalysisQuerySchema.parse(query ?? {});
    return this.service.getQuestionAnalysis(user, itemId, dto);
  }
}
