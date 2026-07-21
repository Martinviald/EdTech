import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { INSTRUMENT_QUALITY_VIEWER_ROLES, instrumentQualityQuerySchema } from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { RequireCapability } from '../common/decorators/capability.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CapabilityGuard } from '../common/guards/capability.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { InstrumentQualityService } from './instrument-quality.service';

@Controller('instrument-quality')
@UseGuards(RolesGuard, CapabilityGuard)
export class InstrumentQualityController {
  constructor(private readonly service: InstrumentQualityService) {}

  /**
   * GET /api/instrument-quality  (H20.9)
   * Calidad psicométrica DETERMINISTA de una evaluación: confiabilidad (KR-20 +
   * interpretación por rangos) y, por ítem, dificultad/discriminación/punto-
   * biserial/distractor dominante con banderas y sugerencias por reglas (sin IA).
   * El scoping por rol y la pertenencia a la org los aplica el service.
   *
   * `@RequireCapability('psychometrics')`: KR-20 y punto-biserial necesitan la
   * ScoreMatrix alumno×ítem, así que una evaluación cargada desde un informe oficial
   * no puede responder acá. Y no basta con dejarla degradar: sin `responses` este
   * módulo no muestra un vacío (compone sobre `report.items`, que siempre existe vía
   * `emptyItemRow`) sino métricas en `—` con el KR-20 en warning y `deriveFlags`
   * marcando `misaligned` todo ítem sin tags. Afirmaría mala calidad donde solo
   * faltan datos. Ver docs/plan-analitica-agregada-informes-oficiales.md §2.8.
   */
  @Get()
  @Roles(...INSTRUMENT_QUALITY_VIEWER_ROLES)
  @RequireCapability('psychometrics')
  getQuality(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const dto = instrumentQualityQuerySchema.parse(query ?? {});
    return this.service.getQuality(user, dto);
  }
}
