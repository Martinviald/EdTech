import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  DASHBOARD_VIEWER_ROLES,
  dashboardFiltersQuerySchema,
  dashboardPerformanceQuerySchema,
  dashboardSkillBreakdownQuerySchema,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { DashboardsService } from './dashboards.service';

/**
 * Dashboards core (S4 — H6.1, H6.2, H6.4, H6.5, H6.7, H6.8). Capa de
 * visualización sobre assessment_results / skill_results. Todos los endpoints
 * aplican scoping por rol en el service (directivo = toda la org; profesor =
 * sólo sus cursos asignados). El org_id SIEMPRE sale del token, nunca del query.
 */
@Controller('dashboards')
@UseGuards(RolesGuard)
export class DashboardsController {
  constructor(private readonly service: DashboardsService) {}

  /**
   * GET /api/dashboards/overview
   * KPIs macro: % logro global, alumnos evaluados, distribución por nivel,
   * últimas evaluaciones y alertas. `scope` = 'teacher' para profesores puros.
   */
  @Get('overview')
  @Roles(...DASHBOARD_VIEWER_ROLES)
  getOverview(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const dto = dashboardFiltersQuerySchema.parse(query ?? {});
    return this.service.getOverview(user, dto);
  }

  /**
   * GET /api/dashboards/filters
   * Opciones de filtros visibles para el scope del usuario (asignaturas, grados,
   * cursos, períodos, instrumentos).
   */
  @Get('filters')
  @Roles(...DASHBOARD_VIEWER_ROLES)
  getFilters(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const dto = dashboardFiltersQuerySchema.parse(query ?? {});
    return this.service.getFilterOptions(user, dto);
  }

  /**
   * GET /api/dashboards/performance
   * Distribución por nivel + clasificación paginada de alumnos. Umbrales (0..1)
   * desde la grading scale aplicable.
   */
  @Get('performance')
  @Roles(...DASHBOARD_VIEWER_ROLES)
  getPerformance(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const dto = dashboardPerformanceQuerySchema.parse(query ?? {});
    return this.service.getPerformance(user, dto);
  }

  /**
   * GET /api/dashboards/skills
   * % logro promedio por habilidad (taxonomy_nodes) sobre el scope filtrado.
   */
  @Get('skills')
  @Roles(...DASHBOARD_VIEWER_ROLES)
  getSkills(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const dto = dashboardFiltersQuerySchema.parse(query ?? {});
    return this.service.getSkills(user, dto);
  }

  /**
   * GET /api/dashboards/skills/breakdown
   * Drill-down jerárquico: % logro de un nodo desglosado por la dimensión
   * `groupBy` (Asignatura/Nivel/Curso/Evaluación), sobre el mismo scope filtrado.
   */
  @Get('skills/breakdown')
  @Roles(...DASHBOARD_VIEWER_ROLES)
  getSkillBreakdown(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const dto = dashboardSkillBreakdownQuerySchema.parse(query ?? {});
    return this.service.getSkillBreakdown(user, dto);
  }

  /**
   * GET /api/dashboards/teacher-kpis
   * Una fila por curso del scope: % logro, tasa de aprobación, alumnos críticos.
   */
  @Get('teacher-kpis')
  @Roles(...DASHBOARD_VIEWER_ROLES)
  getTeacherKpis(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const dto = dashboardFiltersQuerySchema.parse(query ?? {});
    return this.service.getTeacherKpis(user, dto);
  }
}
