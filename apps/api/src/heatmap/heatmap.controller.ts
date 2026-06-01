import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { HEATMAP_VIEWER_ROLES, heatmapQuerySchema } from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { HeatmapService } from './heatmap.service';

/**
 * Mapa de calor (S5 — H6.10). Matriz habilidad (taxonomy_node) × asignatura
 * (subject) de % logro promedio sobre skill_results. Aplica scoping por rol en
 * el service (directivo = toda la org; profesor = sólo sus cursos asignados).
 * El org_id SIEMPRE sale del token, nunca del query.
 */
@Controller('heatmap')
@UseGuards(RolesGuard)
export class HeatmapController {
  constructor(private readonly service: HeatmapService) {}

  /**
   * GET /api/heatmap
   * Devuelve `subjects` (columnas) y `rows` (habilidades, ordenadas por
   * criticidad asc). Filtros opcionales acotan el universo agregado.
   */
  @Get()
  @Roles(...HEATMAP_VIEWER_ROLES)
  getHeatmap(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const dto = heatmapQuerySchema.parse(query ?? {});
    return this.service.getHeatmap(user, dto);
  }
}
