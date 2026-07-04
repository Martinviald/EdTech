import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { remedialMaterials, withOrgContext, type RemedialMaterial } from '@soe/db';
import type { RemedialMaterialType } from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import { RemedialBriefService } from './remedial-brief.service';
import { RemedialContextService } from './remedial-context.service';
import { RemedialService } from './remedial.service';
import { REMEDIAL_GENERATORS, type RemedialGenerator } from './remedial.generator';
import { StimulusResolver } from './stimulus/stimulus.resolver';

const REMEDIAL_TIMEOUT_MS_DEFAULT = 90_000;

/**
 * Ejecuta el ciclo real de generación de material remedial (F2 S3 — H9.1–H9.4).
 *
 * Flujo: markProcessing → contexto RAG (CurriculumRetriever) → generador resuelto
 * por `type` → markReady con el `content` validado + trazabilidad. Todo va dentro
 * de try/catch + timeout (`Promise.race`): cualquier error, salida no parseable,
 * schema inválido o timeout deja el material `failed` (nunca tumba el proceso).
 *
 * La IA NUNCA recibe PII: el contexto es curricular (taxonomy) y, para
 * `group_plan`, el generador agrupa de forma determinista en backend y solo pasa
 * agregados. La salida del modelo vive solo en `content`.
 */
@Injectable()
export class RemedialRunner {
  private readonly generators: Map<RemedialMaterialType, RemedialGenerator>;

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly service: RemedialService,
    private readonly context: RemedialContextService,
    private readonly brief: RemedialBriefService,
    private readonly stimulus: StimulusResolver,
    @Inject(REMEDIAL_GENERATORS) generators: RemedialGenerator[],
  ) {
    this.generators = new Map(generators.map((g) => [g.type, g]));
  }

  async run(materialId: string, orgId: string): Promise<void> {
    try {
      const record = await this.loadRecord(materialId, orgId);
      if (!record.nodeId) {
        throw new Error('El material no tiene un nodo de taxonomía asociado');
      }

      const generator = this.generators.get(record.type);
      if (!generator) {
        throw new Error(`No hay generador para el tipo "${record.type}"`);
      }

      await this.service.markProcessing(materialId, orgId);

      // Brief del error (G4) + contexto curricular enriquecido (G5) + resolución del
      // estímulo (Ola 2.1a) en paralelo. El brief degrada a `null` si no hay evidencia;
      // `assemble` recibe `orgId` para acotar el pool de ítems. El resolver define el
      // `method` efectivo (puede degradar `reuse_stimulus`→`self_contained` si no hay
      // pasaje) y el estímulo hidratado (o `null`). Si el `stimulusId` del docente no es
      // un pasaje visible, `resolve` lanza NotFoundException → el catch deja `failed`.
      const stimulusId = this.readStimulusId(record.input);
      const [brief, curriculum, resolved] = await Promise.all([
        this.brief.build({
          orgId,
          nodeId: record.nodeId,
          assessmentId: record.assessmentId,
          sourceAnalysisId: record.sourceAnalysisId,
        }),
        this.context.assemble(record.nodeId, orgId),
        this.stimulus.resolve({
          orgId,
          assessmentId: record.assessmentId ?? '',
          nodeId: record.nodeId,
          method: record.method,
          stimulusId,
        }),
      ]);

      const result = await this.withTimeout(
        generator.generate({
          material: record,
          orgId,
          curriculum,
          brief,
          stimulus: resolved.stimulus,
        }),
        this.timeoutMs(),
      );

      await this.service.markReady(materialId, orgId, {
        // Auditoría (sin PII): contexto curricular enviado (`result.audit`) + el brief
        // del error usado para anclar la generación. La salida vive solo en `content`.
        content: result.content,
        input: { ...result.audit, brief },
        // Método EFECTIVO resuelto (el generador ya dejó `content.stimuli`).
        method: resolved.method,
        model: result.model,
        promptVersion: result.promptVersion,
        tokens: result.tokens,
        costUsd: result.costUsd,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.service.markFailed(materialId, orgId, message);
    }
  }

  // ---------- helpers ----------

  /**
   * Lee el override de pasaje del docente desde `input.stimulusId` (persistido por
   * `RemedialService.create`). `undefined` si no vino → el resolver elige el pasaje de
   * mayor brecha (o cae a self_contained).
   */
  private readStimulusId(input: Record<string, unknown> | null): string | undefined {
    if (input && typeof input === 'object' && 'stimulusId' in input) {
      const value = (input as { stimulusId?: unknown }).stimulusId;
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return undefined;
  }

  private async loadRecord(materialId: string, orgId: string): Promise<RemedialMaterial> {
    const row = await withOrgContext(this.db, orgId, async (tx) => {
      const [found] = await tx
        .select()
        .from(remedialMaterials)
        .where(and(eq(remedialMaterials.id, materialId), eq(remedialMaterials.orgId, orgId)))
        .limit(1);
      return found;
    });
    if (!row) {
      throw new NotFoundException('Material remedial no encontrado');
    }
    return row;
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Timeout de generación remedial tras ${ms}ms`)),
        ms,
      );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  private timeoutMs(): number {
    const raw = Number(process.env.REMEDIAL_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : REMEDIAL_TIMEOUT_MS_DEFAULT;
  }
}
