import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AI_OBSERVABILITY_VIEWER_ROLES } from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AiObservabilityService } from './ai-observability.service';

/**
 * H19.25 — Observabilidad de costo/latencia IA. Panel de gasto agregado por
 * org/origen/tipo/modelo + presupuesto + serie temporal. SIEMPRE opera sobre la
 * org del token (`user.orgId`). Sólo lectura de datos persistidos (no llama IA).
 *
 * NO se registra en `app.module.ts` aquí — eso lo hace la fase de integración.
 */
@Controller('ai-observability')
@UseGuards(RolesGuard)
export class AiObservabilityController {
  constructor(private readonly service: AiObservabilityService) {}

  /** GET /api/ai-observability/summary — totales + desgloses (default 30 días). */
  @Get('summary')
  @Roles(...AI_OBSERVABILITY_VIEWER_ROLES)
  getSummary(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getSummary(user, from, to);
  }

  /** GET /api/ai-observability/budget — gasto del mes vs tope + nivel de alerta. */
  @Get('budget')
  @Roles(...AI_OBSERVABILITY_VIEWER_ROLES)
  getBudget(@CurrentUser() user: JwtPayload) {
    return this.service.getBudget(user);
  }

  /** GET /api/ai-observability/timeseries — gasto diario (default 30 días). */
  @Get('timeseries')
  @Roles(...AI_OBSERVABILITY_VIEWER_ROLES)
  getTimeseries(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getTimeseries(user, from, to);
  }
}
