import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { instruments, performanceBands } from '@soe/db';
import type {
  PerformanceBandListResponse,
  PerformanceBandResponseModel,
  RecalculateInstrumentBandsResponse,
  UpsertInstrumentBandsDto,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import { AssessmentResultsService } from '../assessment-results/assessment-results.service';

/**
 * Gestión de los niveles/umbrales de logro (performance_bands) por instrumento.
 *
 * Las bandas de instrumentos oficiales son GLOBALES (`org_id NULL`): las comparte
 * toda organización que use ese instrumento. Sólo `platform_admin` las gestiona
 * (`PERFORMANCE_BANDS_ADMIN_ROLES`) — la autoría de cortes oficiales (ej. DIA) es
 * una decisión de plataforma, no de un colegio. Ver
 * docs/analisis-clasificacion-niveles-dia.md.
 *
 * Reemplazo del set = SOFT delete de las bandas globales activas del instrumento
 * (marca `deleted_at`) + insert del nuevo set. El soft delete es obligatorio:
 * `assessment_results.performance_band_id` referencia `performance_bands.id`, así
 * que un hard delete rompería resultados históricos. Los resultados previos
 * siguen apuntando a la banda anterior hasta que se recalculen.
 *
 * Las bandas globales (`org_id NULL`) son accesibles bajo RLS sin fijar contexto
 * de org (la política es `org_id IS NULL OR org_id = current_org`), por eso el
 * service opera sobre `this.db` directamente, igual que GradingScalesService con
 * sus escalas globales.
 */
@Injectable()
export class PerformanceBandsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly assessmentResults: AssessmentResultsService,
  ) {}

  /**
   * Recalcula los resultados de todas las evaluaciones (de todos los colegios)
   * que usan el instrumento, para que reflejen las bandas/umbrales recién
   * guardados. Delega en AssessmentResultsService (lógica de cálculo).
   */
  async recalculateInstrument(instrumentId: string): Promise<RecalculateInstrumentBandsResponse> {
    await this.requireInstrument(instrumentId);
    return this.assessmentResults.recalculateByInstrument(instrumentId);
  }

  /** GET /api/performance-bands?instrumentId= — bandas globales del instrumento. */
  async listByInstrument(instrumentId: string): Promise<PerformanceBandListResponse> {
    await this.requireInstrument(instrumentId);
    const rows = await this.db
      .select()
      .from(performanceBands)
      .where(
        and(
          eq(performanceBands.instrumentId, instrumentId),
          isNull(performanceBands.orgId),
          isNull(performanceBands.deletedAt),
        ),
      )
      .orderBy(asc(performanceBands.order));

    return {
      instrumentId,
      total: rows.length,
      data: rows.map((r) => this.toResponseModel(r)),
    };
  }

  /**
   * PUT /api/instruments/:id/performance-bands — reemplaza el set completo de
   * bandas globales del instrumento. El DTO ya viene validado (cobertura [0,1]
   * contigua, sin huecos/solapes) por `upsertInstrumentBandsSchema`.
   */
  async upsertInstrumentBands(
    instrumentId: string,
    dto: UpsertInstrumentBandsDto,
  ): Promise<PerformanceBandListResponse> {
    await this.requireInstrument(instrumentId);

    const now = new Date();
    return this.db.transaction(async (tx) => {
      // Soft-delete de las bandas globales activas actuales del instrumento.
      await tx
        .update(performanceBands)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(performanceBands.instrumentId, instrumentId),
            isNull(performanceBands.orgId),
            isNull(performanceBands.deletedAt),
          ),
        );

      await tx.insert(performanceBands).values(
        dto.bands.map((b) => ({
          instrumentId,
          scaleId: null,
          orgId: null, // banda global compartida por todas las orgs
          key: b.key,
          label: b.label,
          order: b.order,
          minThreshold: b.minThreshold.toFixed(4),
          maxThreshold: b.maxThreshold.toFixed(4),
          color: b.color ?? null,
        })),
      );

      const rows = await tx
        .select()
        .from(performanceBands)
        .where(
          and(
            eq(performanceBands.instrumentId, instrumentId),
            isNull(performanceBands.orgId),
            isNull(performanceBands.deletedAt),
          ),
        )
        .orderBy(asc(performanceBands.order));

      return {
        instrumentId,
        total: rows.length,
        data: rows.map((r) => this.toResponseModel(r)),
      };
    });
  }

  private async requireInstrument(instrumentId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: instruments.id, deletedAt: instruments.deletedAt })
      .from(instruments)
      .where(eq(instruments.id, instrumentId))
      .limit(1);
    if (!row || row.deletedAt) {
      throw new NotFoundException('Instrumento no encontrado');
    }
  }

  private toResponseModel(r: typeof performanceBands.$inferSelect): PerformanceBandResponseModel {
    return {
      id: r.id,
      instrumentId: r.instrumentId,
      scaleId: r.scaleId,
      orgId: r.orgId,
      key: r.key,
      label: r.label,
      order: r.order,
      minThreshold: r.minThreshold,
      maxThreshold: r.maxThreshold,
      color: r.color,
      isGlobal: r.orgId === null,
    };
  }
}
