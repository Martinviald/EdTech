import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ANALYTICS_VIEWER_ROLES, comparableTrajectoryQuerySchema } from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ComparableTrajectoryService } from './comparable-trajectory.service';

@Controller('analytics')
@UseGuards(RolesGuard)
export class AnalyticsController {
  constructor(private readonly trajectory: ComparableTrajectoryService) {}

  /**
   * GET /api/analytics/comparable-trajectory
   *
   * La vista unificada de "Trayectoria comparable" (docs/diseno-comparacion-progresion.md):
   * una familia comparable (tipo + asignatura + nivel) a lo largo de un eje —años (N2) o
   * momentos del ciclo (N3)— con sus baselines. Reemplaza los antiguos endpoints
   * `generational` (H6.3) y `progression` (H6.6), que promediaban instrumentos no
   * comparables.
   */
  @Get('comparable-trajectory')
  @Roles(...ANALYTICS_VIEWER_ROLES)
  comparableTrajectory(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const dto = comparableTrajectoryQuerySchema.parse(query ?? {});
    return this.trajectory.trajectory(user, dto);
  }
}
