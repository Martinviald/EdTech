import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  INSTRUMENT_QUALITY_VIEWER_ROLES,
  instrumentQualityQuerySchema,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { InstrumentQualityService } from './instrument-quality.service';

@Controller('instrument-quality')
@UseGuards(RolesGuard)
export class InstrumentQualityController {
  constructor(private readonly service: InstrumentQualityService) {}

  /**
   * GET /api/instrument-quality  (H20.9)
   * Calidad psicométrica DETERMINISTA de una evaluación: confiabilidad (KR-20 +
   * interpretación por rangos) y, por ítem, dificultad/discriminación/punto-
   * biserial/distractor dominante con banderas y sugerencias por reglas (sin IA).
   * El scoping por rol y la pertenencia a la org los aplica el service.
   */
  @Get()
  @Roles(...INSTRUMENT_QUALITY_VIEWER_ROLES)
  getQuality(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const dto = instrumentQualityQuerySchema.parse(query ?? {});
    return this.service.getQuality(user, dto);
  }
}
