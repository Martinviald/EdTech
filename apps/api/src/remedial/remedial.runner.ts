import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { remedialMaterials, withOrgContext, type RemedialMaterial } from '@soe/db';
import type { RemedialMaterialType } from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import { RemedialContextService } from './remedial-context.service';
import { RemedialService } from './remedial.service';
import { REMEDIAL_GENERATORS, type RemedialGenerator } from './remedial.generator';

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

      const curriculum = await this.context.assemble(record.nodeId);

      const result = await this.withTimeout(
        generator.generate({ material: record, orgId, curriculum }),
        this.timeoutMs(),
      );

      await this.service.markReady(materialId, orgId, {
        content: result.content,
        input: result.audit,
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
