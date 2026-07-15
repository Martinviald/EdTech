import { CanActivate, ConflictException, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { assessments, withOrgContext } from '@soe/db';
import {
  CAPABILITY_UNAVAILABLE_CODE,
  capabilityUnavailableMessage,
  supportsCapability,
  type AnalyticsCapability,
  type DataGranularity,
} from '@soe/types';
import { CAPABILITY_KEY } from '../decorators/capability.decorator';
import { InjectDb, type Database } from '../../database/database.types';
import type { JwtPayload } from '../../auth/jwt-payload.types';

/**
 * Cierra las rutas cuya analítica exige respuestas alumno×pregunta cuando la
 * evaluación se cargó desde un informe oficial (`data_granularity='aggregate_only'`).
 *
 * ⚠️ A diferencia de RolesGuard y FeatureGuard, **platform_admin NO se exime**. No es
 * un chequeo de permiso sino de disponibilidad del dato: si no existen las respuestas
 * por alumno, no existen para nadie. Eximir al platform_admin solo le mostraría una
 * matriz vacía haciéndola pasar por real.
 *
 * Por qué un guard y no dejar que degrade solo: sin `responses`, `instrument-quality`
 * no muestra un vacío — **afirma mala calidad** (KR-20 en warning + flags `misaligned`
 * inflados sobre ítems sin tags), y `ai-analysis` le pasa al LLM un snapshot sin
 * psicometría y sin ninguna señal de "no aplica". Degradar en silencio miente.
 *
 * Responde 409 con un código legible por máquina para que la web pinte un estado
 * vacío específico en vez de un error genérico. Mismo espíritu que el
 * `suppressed`+`suppressionReason` del benchmarking: el backend decide Y explica.
 *
 * Se usa después de RolesGuard: `@UseGuards(RolesGuard, CapabilityGuard)`.
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectDb() private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const capability = this.reflector.getAllAndOverride<AnalyticsCapability | undefined>(
      CAPABILITY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!capability) return true;

    const req = context.switchToHttp().getRequest<{
      user: JwtPayload;
      params?: Record<string, string>;
      query?: Record<string, unknown>;
    }>();

    const assessmentId = resolveAssessmentId(req.params, req.query);
    // Sin assessmentId la ruta agrega across assessments: el read-model es homogéneo
    // y la mezcla de granularidades es legítima. La decisión, si hace falta, va en
    // el service.
    if (!assessmentId) return true;

    const orgId = req.user.orgId;
    if (!orgId) return true; // RolesGuard/el service resuelven la falta de org.

    // `assessments` está bajo RLS: sin contexto la query devuelve 0 filas.
    const granularity = await withOrgContext(this.db, orgId, async (tx) => {
      const [row] = await tx
        .select({ dataGranularity: assessments.dataGranularity })
        .from(assessments)
        .where(eq(assessments.id, assessmentId));
      return row?.dataGranularity as DataGranularity | undefined;
    });

    // Inexistente o de otra org: que el service responda 404/403 con su propio
    // mensaje. Un guard de capacidad no debe filtrar la existencia de un recurso.
    if (!granularity) return true;

    if (!supportsCapability(granularity, capability)) {
      throw new ConflictException({
        statusCode: 409,
        error: 'CapabilityUnavailable',
        code: CAPABILITY_UNAVAILABLE_CODE,
        capability,
        message: capabilityUnavailableMessage(capability),
      });
    }
    return true;
  }
}

const ASSESSMENT_ID_KEYS = ['assessmentId', 'assessment_id'] as const;

function resolveAssessmentId(
  params: Record<string, string> | undefined,
  query: Record<string, unknown> | undefined,
): string | null {
  for (const key of ASSESSMENT_ID_KEYS) {
    const fromParams = params?.[key];
    if (typeof fromParams === 'string' && fromParams.length > 0) return fromParams;
    const fromQuery = query?.[key];
    if (typeof fromQuery === 'string' && fromQuery.length > 0) return fromQuery;
  }
  return null;
}
