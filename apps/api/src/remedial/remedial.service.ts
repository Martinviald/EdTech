import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  instrumentSections,
  items,
  remedialMaterials,
  taxonomyNodes,
  withOrgContext,
  type RemedialMaterial,
} from '@soe/db';
import {
  qualityReportSchema,
  validateItemContent,
  validateRemedialContent,
  type GenerateRemedialDto,
  type QualityReport,
  type RemedialContent,
  type RemedialListQueryDto,
  type RemedialListResponse,
  type RemedialMaterialModel,
  type RemedialMaterialType,
  type RemedialMethod,
  type RemedialPracticeItemPreview,
  type RemedialStimulus,
  type ReviewRemedialDto,
  type UpdateRemedialItemDto,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { GROUP_PLAN_PROMPT_VERSION } from './prompts/group-plan.prompt';
import { GUIDE_PROMPT_VERSION } from './prompts/guide.prompt';
import {
  PRACTICE_PROMPT_VERSION,
  PRACTICE_STIMULUS_PROMPT_VERSION,
} from './prompts/practice.prompt';

/**
 * Versión de prompt vigente por tipo. Entra en el `inputHash` de la caché para que
 * un bump de prompt (p. ej. `s3-practice-v1` → `ola1-practice-v2`) invalide el
 * material previo en lugar de servir una versión vieja desde caché.
 */
const PROMPT_VERSION_BY_TYPE: Record<RemedialMaterialType, string> = {
  guide: GUIDE_PROMPT_VERSION,
  practice_set: PRACTICE_PROMPT_VERSION,
  group_plan: GROUP_PLAN_PROMPT_VERSION,
};

/** Cantidad de ítems de práctica por defecto cuando el DTO no la especifica. */
const DEFAULT_PRACTICE_ITEM_COUNT = 5;

/** Datos que `markReady` persiste al cerrar la generación con éxito. */
export interface MarkReadyInput {
  content: RemedialContent;
  input: Record<string, unknown>;
  /** Método EFECTIVO resuelto por el runner (Ola 2.1a); puede diferir del solicitado. */
  method: RemedialMethod;
  model: string | null;
  promptVersion: string | null;
  tokens: { input: number; output: number } | null;
  costUsd: string | null;
  /**
   * Reporte del juez (Ola 2.1b): iteraciones + veredicto final por ítem. Solo lo trae
   * `practice_set` (viene del loop de calidad); `null`/ausente en el resto.
   */
  qualityReport?: QualityReport | null;
}

/**
 * Resultado de `create`: el registro de dominio + bandera de caché (para que el
 * controller decida si encola o no el job async).
 */
export interface CreateRemedialResult {
  material: RemedialMaterialModel;
  fromCache: boolean;
}

/**
 * Registro + caché + workflow de material remedial (F2 S3 — H9.1/H9.5).
 *
 * Toda query a `remedial_materials` / `items` corre dentro de `withOrgContext`
 * (RLS por org_id); el `orgId` proviene SIEMPRE del token (`user.orgId`), nunca
 * del body. La salida del modelo vive solo en `content` (validado con
 * `validateRemedialContent`). Principio rector (CLAUDE.md §8.3): la IA propone
 * (`ready`), el humano aprueba (`approved`) o descarta (`discarded`).
 */
@Injectable()
export class RemedialService {
  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * Crea (o reutiliza desde caché) un registro de material remedial.
   *
   * - `inputHash` determinista de {type, nodeId, classGroupId, itemCount, method,
   *   stimulusId}.
   * - Si existe una fila cacheable (`ready`/`approved`) con ese hash y NO `force`
   *   → la devuelve (`fromCache: true`).
   * - En cualquier otro caso inserta una fila `pending` y la devuelve.
   */
  async create(
    user: JwtPayload,
    dto: GenerateRemedialDto,
  ): Promise<CreateRemedialResult> {
    const orgId = this.requireOrgId(user);
    const itemCount =
      dto.type === 'practice_set'
        ? dto.itemCount ?? DEFAULT_PRACTICE_ITEM_COUNT
        : null;
    // Ola 2.1a: método remedial (default self_contained) + override de pasaje del
    // docente. Ambos entran en la caché (mismo nodo con/sin pasaje NO deben colisionar)
    // y se persisten (`method` en columna, `stimulusId` en `input`) para que el runner
    // los reproduzca.
    const method: RemedialMethod = dto.method ?? 'self_contained';
    const stimulusId = dto.stimulusId ?? null;
    const inputHash = this.computeInputHash({
      type: dto.type,
      nodeId: dto.nodeId,
      classGroupId: dto.classGroupId ?? null,
      itemCount,
      // Distinto diagnóstico de origen no debe colisionar en caché (el brief que
      // ancla la generación depende del análisis IA).
      sourceAnalysisId: dto.sourceAnalysisId ?? null,
      method,
      stimulusId,
      // Bump de prompt → clave distinta (no reutilizar material de una versión vieja).
      // El modo con estímulo tiene su propia versión (no colisiona con self_contained).
      promptVersion: this.resolvePromptVersion(dto.type, method),
    });

    return withOrgContext(this.db, orgId, async (tx) => {
      if (!dto.force) {
        const [existing] = await tx
          .select()
          .from(remedialMaterials)
          .where(
            and(
              eq(remedialMaterials.orgId, orgId),
              eq(remedialMaterials.inputHash, inputHash),
              isNull(remedialMaterials.deletedAt),
            ),
          )
          .orderBy(desc(remedialMaterials.createdAt))
          .limit(1);

        if (existing && this.isCacheable(existing)) {
          const model = await this.toModel(tx, existing);
          return { material: model, fromCache: true };
        }
      }

      const [inserted] = await tx
        .insert(remedialMaterials)
        .values({
          orgId,
          type: dto.type,
          status: 'pending',
          method,
          nodeId: dto.nodeId,
          assessmentId: dto.assessmentId ?? null,
          classGroupId: dto.classGroupId ?? null,
          sourceAnalysisId: dto.sourceAnalysisId ?? null,
          inputHash,
          // Parámetros deterministas de generación (no PII). El runner los lee
          // para reproducir la generación; markReady reescribe `input` con el
          // contexto RAG auditado.
          input: this.buildCreateInput(itemCount, stimulusId),
          createdById: user.userId,
        })
        .returning();

      if (!inserted) {
        throw new Error('No se pudo crear el material remedial');
      }
      const model = await this.toModel(tx, inserted);
      return { material: model, fromCache: false };
    });
  }

  /** Devuelve un material por id dentro del tenant del usuario. */
  async get(user: JwtPayload, id: string): Promise<RemedialMaterialModel> {
    const orgId = this.requireOrgId(user);
    return withOrgContext(this.db, orgId, async (tx) => {
      const row = await this.findOne(tx, id, orgId);
      if (!row) {
        throw new NotFoundException('Material remedial no encontrado');
      }
      const model = await this.toModel(tx, row);

      // Hidratación on-read del preview de ítems (G2): solo para practice_set en
      // estado revisable. El ítem completo (enunciado + alternativas + clave +
      // explicación) se lee de `items` (fuente de verdad); NO se persiste, el
      // `content` (refs ligeras) queda intacto. Junto a él (Ola 2.1a), el TEXTO
      // completo del pasaje se re-hidrata desde `instrument_sections` para los sets
      // con estímulo (`content.stimuli` no vacío); self_contained → `[]`.
      if (
        row.type === 'practice_set' &&
        (row.status === 'ready' || row.status === 'approved')
      ) {
        model.practiceItems = await this.hydratePracticeItems(tx, row.content, orgId);
        model.stimuli = await this.hydrateStimuli(tx, row.content, orgId);
      }

      return model;
    });
  }

  /** Banco de material remedial paginado (filtra `deletedAt IS NULL`). */
  async list(
    user: JwtPayload,
    query: RemedialListQueryDto,
  ): Promise<RemedialListResponse> {
    const orgId = this.requireOrgId(user);
    const { page, limit } = query;

    return withOrgContext(this.db, orgId, async (tx) => {
      const conditions = [
        eq(remedialMaterials.orgId, orgId),
        isNull(remedialMaterials.deletedAt),
      ];
      if (query.type) conditions.push(eq(remedialMaterials.type, query.type));
      if (query.status) conditions.push(eq(remedialMaterials.status, query.status));
      if (query.nodeId) conditions.push(eq(remedialMaterials.nodeId, query.nodeId));
      if (query.assessmentId) {
        conditions.push(eq(remedialMaterials.assessmentId, query.assessmentId));
      }

      const where = and(...conditions);
      const rows = await tx
        .select()
        .from(remedialMaterials)
        .where(where)
        .orderBy(desc(remedialMaterials.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      const allRows = await tx
        .select({ id: remedialMaterials.id })
        .from(remedialMaterials)
        .where(where);
      const total = allRows.length;

      const data = await Promise.all(rows.map((row) => this.toModel(tx, row)));
      return { data, total, page, limit };
    });
  }

  /** Marca el material como `processing` y sella `startedAt`. */
  async markProcessing(id: string, orgId: string): Promise<void> {
    await withOrgContext(this.db, orgId, async (tx) => {
      await tx
        .update(remedialMaterials)
        .set({ status: 'processing', startedAt: new Date(), updatedAt: new Date() })
        .where(
          and(eq(remedialMaterials.id, id), eq(remedialMaterials.orgId, orgId)),
        );
    });
  }

  /**
   * Marca el material como `ready` (borrador) con la salida del modelo en
   * `content` (re-validada). Trazabilidad: `model`, `promptVersion`, `tokens`,
   * `costUsd`, `input` (contexto RAG, sin PII).
   */
  async markReady(id: string, orgId: string, data: MarkReadyInput): Promise<void> {
    await withOrgContext(this.db, orgId, async (tx) => {
      await tx
        .update(remedialMaterials)
        .set({
          status: 'ready',
          content: data.content,
          input: data.input,
          // Método EFECTIVO (Ola 2.1a): el resolver pudo degradar el solicitado.
          method: data.method,
          // Reporte del juez (Ola 2.1b): `null` en tipos sin loop (guide/group_plan).
          qualityReport: data.qualityReport ?? null,
          model: data.model,
          promptVersion: data.promptVersion,
          tokens: data.tokens,
          costUsd: data.costUsd,
          error: null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(eq(remedialMaterials.id, id), eq(remedialMaterials.orgId, orgId)),
        );
    });
  }

  /** Marca el material como `failed` con el mensaje de error. */
  async markFailed(id: string, orgId: string, error: string): Promise<void> {
    await withOrgContext(this.db, orgId, async (tx) => {
      await tx
        .update(remedialMaterials)
        .set({
          status: 'failed',
          error,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(eq(remedialMaterials.id, id), eq(remedialMaterials.orgId, orgId)),
        );
    });
  }

  /**
   * Revisión humana (H9.5): aprobar o descartar. Valida estado `ready`.
   * - `approve` → `status='approved'`, persiste `content` editado si vino
   *   (re-validado), sella `reviewedById`/`reviewedAt`; si es `practice_set`
   *   publica los ítems referenciados (`items.status='published'`).
   * - `discard` → `status='discarded'`.
   */
  async review(
    user: JwtPayload,
    id: string,
    dto: ReviewRemedialDto,
  ): Promise<RemedialMaterialModel> {
    const orgId = this.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      const row = await this.findOne(tx, id, orgId);
      if (!row) {
        throw new NotFoundException('Material remedial no encontrado');
      }
      if (row.status !== 'ready') {
        throw new BadRequestException(
          `Solo se puede revisar material en estado "ready" (actual: "${row.status}")`,
        );
      }

      if (dto.action === 'discard') {
        await tx
          .update(remedialMaterials)
          .set({
            status: 'discarded',
            reviewedById: user.userId,
            reviewedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(eq(remedialMaterials.id, id), eq(remedialMaterials.orgId, orgId)),
          );
        const updated = await this.findOne(tx, id, orgId);
        return this.toModel(tx, updated!);
      }

      // approve: el humano puede haber editado el content (override).
      const finalContent: RemedialContent = dto.content
        ? validateRemedialContent(row.type, dto.content)
        : validateRemedialContent(row.type, row.content);

      await tx
        .update(remedialMaterials)
        .set({
          status: 'approved',
          content: finalContent,
          reviewedById: user.userId,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(eq(remedialMaterials.id, id), eq(remedialMaterials.orgId, orgId)),
        );

      // Aprobar un practice_set publica sus ítems generados (draft → published).
      if (row.type === 'practice_set' && 'items' in finalContent) {
        const itemIds = finalContent.items.map((ref) => ref.itemId);
        if (itemIds.length > 0) {
          await tx
            .update(items)
            .set({ status: 'published', updatedAt: new Date() })
            .where(
              and(
                inArray(items.id, itemIds),
                eq(items.orgId, orgId),
                isNull(items.deletedAt),
              ),
            );
        }
      }

      const updated = await this.findOne(tx, id, orgId);
      return this.toModel(tx, updated!);
    });
  }

  /**
   * Edita un ítem `draft` de un `practice_set` en `ready` (Ola 1‑resto G2). Es el
   * "humano AJUSTA" de CLAUDE.md §8.3: se corrige el borrador antes de publicarlo,
   * NUNCA se toca la evidencia IA original (el brief/contexto queda en
   * `remedial_materials.input`). Enunciado, alternativas, cuál es la correcta y
   * explicación.
   *
   * - `remedial_materials` bajo `withOrgContext`+`tx`; el `item` (tabla `items`, sin
   *   RLS) se aísla con filtro `org_id` EXPLÍCITO (§5.2).
   * - Regla de negocio: EXACTAMENTE una alternativa correcta (además del Zod del DTO).
   * - Preserva los campos no editables del content existente (p. ej. `imageUrl`) y
   *   sobrescribe `stem`/`alternatives`/`explanation`; re-valida con
   *   `validateItemContent` (ítems polimórficos).
   */
  async updateItem(
    orgId: string,
    materialId: string,
    itemId: string,
    dto: UpdateRemedialItemDto,
  ): Promise<RemedialPracticeItemPreview> {
    // Regla "exactamente una correcta" (el Zod del DTO solo garantiza ≥2 alternativas).
    const correctCount = dto.alternatives.filter((alt) => alt.isCorrect).length;
    if (correctCount !== 1) {
      throw new BadRequestException('Debe haber exactamente una alternativa correcta');
    }

    return withOrgContext(this.db, orgId, async (tx) => {
      const { content, ref } = await this.loadPracticeRef(tx, materialId, itemId, orgId);

      // El ítem debe ser un borrador generado por IA de esta org (items NO tiene RLS
      // → filtro org_id EXPLÍCITO). No editar ítems ya publicados ni de otro pool.
      const [item] = await tx
        .select({ id: items.id, type: items.type, content: items.content })
        .from(items)
        .where(
          and(
            eq(items.id, itemId),
            eq(items.orgId, orgId),
            eq(items.status, 'draft'),
            eq(items.source, 'ai_generated'),
            isNull(items.deletedAt),
          ),
        )
        .limit(1);
      if (!item) {
        throw new NotFoundException(
          'Ítem editable no encontrado (debe ser un borrador generado por IA de esta organización)',
        );
      }

      // Ensambla el nuevo content MC preservando lo no editable (imageUrl, …) y
      // sobrescribiendo lo editado. `explanation`: omitida → se preserva; null/"" →
      // se limpia; string → se fija.
      const existing = (item.content ?? {}) as Record<string, unknown>;
      const nextContentRaw: Record<string, unknown> = {
        ...existing,
        stem: dto.stem,
        alternatives: dto.alternatives,
      };
      if (dto.explanation !== undefined) {
        if (dto.explanation && dto.explanation.trim() !== '') {
          nextContentRaw.explanation = dto.explanation;
        } else {
          delete nextContentRaw.explanation;
        }
      }
      // Valida polimórficamente + re-aplica la regla del validador MC.
      const validated = validateItemContent('multiple_choice', nextContentRaw);

      await tx
        .update(items)
        .set({ content: validated, updatedAt: new Date() })
        .where(and(eq(items.id, itemId), eq(items.orgId, orgId)));

      // Refleja el nuevo enunciado en el ref del material (preview ligero), coherente
      // con `hydratePracticeItems` (fuente de verdad = `items`). El spread preserva los
      // `stimuli` del set (Ola 2.1a) intactos.
      const nextItems = content.items.map((r) =>
        r.itemId === itemId ? { ...r, stem: dto.stem } : r,
      );
      const nextContent: RemedialContent = { ...content, items: nextItems };
      await tx
        .update(remedialMaterials)
        .set({ content: nextContent, updatedAt: new Date() })
        .where(
          and(eq(remedialMaterials.id, materialId), eq(remedialMaterials.orgId, orgId)),
        );

      const alternatives = extractAlternatives(validated);
      return {
        itemId,
        position: ref.position,
        type: item.type,
        stem: extractStem(validated),
        alternatives,
        correctKey: extractCorrectKey(alternatives),
        explanation: extractExplanation(validated),
      };
    });
  }

  /**
   * Quita un ítem de un `practice_set` en `ready` (Ola 1‑resto G2): saca el ref de
   * `content.items`, hace **soft-delete** del ítem draft (`items.deletedAt=now()`,
   * nunca DELETE — §5.2) y reindexa las `position` de los refs restantes. No se
   * permite dejar el set vacío (mín. 1 ítem → 400). Devuelve el material actualizado
   * con el preview re-hidratado.
   */
  async removeItem(
    orgId: string,
    materialId: string,
    itemId: string,
  ): Promise<RemedialMaterialModel> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const { content } = await this.loadPracticeRef(tx, materialId, itemId, orgId);

      if (content.items.length <= 1) {
        throw new BadRequestException('El set debe conservar al menos un ítem');
      }

      // El ítem debe ser un borrador de esta org (items NO tiene RLS → filtro explícito).
      const [item] = await tx
        .select({ id: items.id })
        .from(items)
        .where(
          and(
            eq(items.id, itemId),
            eq(items.orgId, orgId),
            eq(items.status, 'draft'),
            eq(items.source, 'ai_generated'),
            isNull(items.deletedAt),
          ),
        )
        .limit(1);
      if (!item) {
        throw new NotFoundException(
          'Ítem editable no encontrado (debe ser un borrador generado por IA de esta organización)',
        );
      }

      // Reindexa las posiciones de los refs restantes (1..N-1) preservando el orden.
      // El spread preserva los `stimuli` del set (Ola 2.1a).
      const remaining = content.items
        .filter((r) => r.itemId !== itemId)
        .map((r, idx) => ({ ...r, position: idx + 1 }));
      const nextContent: RemedialContent = {
        ...content,
        items: remaining,
        itemCount: remaining.length,
      };

      await tx
        .update(remedialMaterials)
        .set({ content: nextContent, updatedAt: new Date() })
        .where(
          and(eq(remedialMaterials.id, materialId), eq(remedialMaterials.orgId, orgId)),
        );

      // Soft-delete del ítem draft (la evidencia IA original queda en `input`).
      await tx
        .update(items)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(items.id, itemId), eq(items.orgId, orgId)));

      const updated = await this.findOne(tx, materialId, orgId);
      const model = await this.toModel(tx, updated!);
      // Re-hidrata el preview de ítems y los estímulos (coherente con `get`).
      model.practiceItems = await this.hydratePracticeItems(tx, updated!.content, orgId);
      model.stimuli = await this.hydrateStimuli(tx, updated!.content, orgId);
      return model;
    });
  }

  // ---------- helpers ----------

  /**
   * Carga un `practice_set` editable y el ref del ítem pedido, validando el estado.
   * Encapsula las precondiciones comunes de `updateItem`/`removeItem`: material de la
   * org (`withOrgContext`+`tx`), `type='practice_set'`, `status='ready'`, y `itemId`
   * presente en `content.items`.
   */
  private async loadPracticeRef(
    tx: Database,
    materialId: string,
    itemId: string,
    orgId: string,
  ) {
    const material = await this.findOne(tx, materialId, orgId);
    if (!material) {
      throw new NotFoundException('Material remedial no encontrado');
    }
    if (material.type !== 'practice_set') {
      throw new BadRequestException('Solo los sets de práctica tienen ítems editables');
    }
    if (material.status !== 'ready') {
      throw new BadRequestException(
        `Solo se pueden editar ítems de un set en estado "ready" (actual: "${material.status}")`,
      );
    }
    const content = material.content;
    if (!content || !('items' in content)) {
      throw new NotFoundException('El set no tiene ítems');
    }
    const ref = content.items.find((r) => r.itemId === itemId);
    if (!ref) {
      throw new NotFoundException('El ítem no pertenece a este set');
    }
    return { material, content, ref };
  }

  private async findOne(
    tx: Database,
    id: string,
    orgId: string,
  ): Promise<RemedialMaterial | undefined> {
    const [row] = await tx
      .select()
      .from(remedialMaterials)
      .where(
        and(
          eq(remedialMaterials.id, id),
          eq(remedialMaterials.orgId, orgId),
          isNull(remedialMaterials.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  /** Una fila sirve como caché solo si ya está `ready` o `approved`. */
  private isCacheable(row: RemedialMaterial): boolean {
    return row.status === 'ready' || row.status === 'approved';
  }

  private computeInputHash(input: {
    type: string;
    nodeId: string;
    classGroupId: string | null;
    itemCount: number | null;
    sourceAnalysisId: string | null;
    method: RemedialMethod;
    stimulusId: string | null;
    promptVersion: string;
  }): string {
    // Orden de claves fijo → hash determinista independiente del insertion order.
    const canonical = JSON.stringify({
      type: input.type,
      nodeId: input.nodeId,
      classGroupId: input.classGroupId,
      itemCount: input.itemCount,
      sourceAnalysisId: input.sourceAnalysisId,
      // Ola 2.1a: método + pasaje elegido → el mismo nodo con/sin estímulo (o con
      // pasajes distintos) genera material distinto y no debe compartir caché.
      method: input.method,
      stimulusId: input.stimulusId,
      promptVersion: input.promptVersion,
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Versión de prompt EFECTIVA para la caché. `practice_set` en modo `reuse_stimulus`
   * usa el prompt anclado al pasaje (versión propia); el resto usa la versión por tipo.
   */
  private resolvePromptVersion(
    type: RemedialMaterialType,
    method: RemedialMethod,
  ): string {
    if (type === 'practice_set' && method === 'reuse_stimulus') {
      return PRACTICE_STIMULUS_PROMPT_VERSION;
    }
    return PROMPT_VERSION_BY_TYPE[type];
  }

  /**
   * Arma el `input` determinista de la fila `pending` (no PII): `itemCount` (solo
   * practice_set) + `stimulusId` (override del docente, Ola 2.1a). `null` si no hay nada.
   */
  private buildCreateInput(
    itemCount: number | null,
    stimulusId: string | null,
  ): Record<string, unknown> | null {
    const meta: Record<string, unknown> = {};
    if (itemCount !== null) meta.itemCount = itemCount;
    if (stimulusId) meta.stimulusId = stimulusId;
    return Object.keys(meta).length > 0 ? meta : null;
  }

  private requireOrgId(user: JwtPayload): string {
    if (!user.orgId) {
      throw new ForbiddenException(
        'Sin organización activa. Selecciona una organización antes de continuar.',
      );
    }
    return user.orgId;
  }

  /** Arma el `RemedialMaterialModel` joineando `nodeName` de `taxonomy_nodes`. */
  private async toModel(
    tx: Database,
    row: RemedialMaterial,
  ): Promise<RemedialMaterialModel> {
    let nodeName: string | null = null;
    if (row.nodeId) {
      const [node] = await tx
        .select({ name: taxonomyNodes.name })
        .from(taxonomyNodes)
        .where(eq(taxonomyNodes.id, row.nodeId))
        .limit(1);
      nodeName = node?.name ?? null;
    }

    return {
      id: row.id,
      orgId: row.orgId,
      type: row.type,
      status: row.status,
      method: row.method,
      nodeId: row.nodeId,
      nodeName,
      assessmentId: row.assessmentId,
      classGroupId: row.classGroupId,
      title: row.title,
      content: row.content ?? null,
      // Ola 2.1b: reporte del juez leído on-read desde la fila (parseado/validado;
      // `null` si no hay o si la fila trae un shape viejo/incompatible).
      qualityReport: this.parseQualityReport(row.qualityReport),
      model: row.model,
      promptVersion: row.promptVersion,
      costUsd: row.costUsd,
      error: row.error,
      createdById: row.createdById,
      reviewedById: row.reviewedById,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    };
  }

  /**
   * Parsea/valida el `qualityReport` crudo de la fila (JSONB genérico) con
   * `qualityReportSchema` (Ola 2.1b). `null` si la fila no lo trae o si su shape no
   * valida (degradación elegante: nunca rompe la lectura del material).
   */
  private parseQualityReport(raw: Record<string, unknown> | null): QualityReport | null {
    if (!raw) return null;
    const parsed = qualityReportSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  /**
   * Hidrata el preview completo de los ítems de práctica leyéndolos de `items`
   * (fuente de verdad) por los `itemId` guardados en el `content`. `items` NO está
   * bajo RLS → aislamiento con filtro EXPLÍCITO de pool visible
   * (`org_id = :orgId ∪ org_id IS NULL`) + soft-delete (CLAUDE.md §5.2). Se arma
   * on-read; el `content` (refs) no se modifica. Un ítem ausente (borrado o fuera
   * del pool) se omite del preview sin romper el resto.
   */
  private async hydratePracticeItems(
    tx: Database,
    content: RemedialContent | null,
    orgId: string,
  ): Promise<RemedialPracticeItemPreview[]> {
    if (!content || !('items' in content) || content.items.length === 0) {
      return [];
    }
    const refs = content.items;
    const itemIds = refs.map((ref) => ref.itemId);

    const rows = await tx
      .select({ id: items.id, type: items.type, content: items.content })
      .from(items)
      .where(
        and(
          inArray(items.id, itemIds),
          or(eq(items.orgId, orgId), isNull(items.orgId)),
          isNull(items.deletedAt),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));

    const previews: RemedialPracticeItemPreview[] = [];
    for (const ref of refs) {
      const item = byId.get(ref.itemId);
      if (!item) continue;
      const alternatives = extractAlternatives(item.content);
      previews.push({
        itemId: item.id,
        position: ref.position,
        type: item.type,
        stem: extractStem(item.content),
        alternatives,
        correctKey: extractCorrectKey(alternatives),
        explanation: extractExplanation(item.content),
      });
    }
    return previews;
  }

  /**
   * Hidrata el TEXTO COMPLETO de los estímulos (pasajes) del set desde
   * `instrument_sections` por los `sectionId` de `content.stimuli` (Ola 2.1a).
   * `instrument_sections` NO está bajo RLS → aislamiento con filtro EXPLÍCITO del pool
   * visible (`org_id = :orgId ∪ org_id IS NULL`, patrón `items`). Se arma on-read; el
   * `content` (refs ligeras) no se modifica. Una sección ausente se omite sin romper el
   * resto. `[]` para sets self_contained (sin `stimuli`).
   */
  private async hydrateStimuli(
    tx: Database,
    content: RemedialContent | null,
    orgId: string,
  ): Promise<RemedialStimulus[]> {
    if (!content || !('stimuli' in content) || content.stimuli.length === 0) {
      return [];
    }
    const refs = content.stimuli;
    const sectionIds = refs.map((ref) => ref.sectionId);

    const rows = await tx
      .select({
        id: instrumentSections.id,
        kind: instrumentSections.kind,
        source: instrumentSections.source,
        passageTitle: instrumentSections.passageTitle,
        passageText: instrumentSections.passageText,
      })
      .from(instrumentSections)
      .where(
        and(
          inArray(instrumentSections.id, sectionIds),
          or(eq(instrumentSections.orgId, orgId), isNull(instrumentSections.orgId)),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));

    const stimuli: RemedialStimulus[] = [];
    for (const ref of refs) {
      const section = byId.get(ref.sectionId);
      if (!section) continue;
      stimuli.push({
        sectionId: section.id,
        kind: section.kind,
        source: section.source,
        title: section.passageTitle ?? null,
        text: section.passageText ?? null,
      });
    }
    return stimuli;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Extracción defensiva del `content` polimórfico de un ítem (G2). El banco es
// heterogéneo por `item_type`: se parsea campo a campo (no contra el schema
// estricto, que rechazaría un ítem entero por un detalle). Degrada a `null`.
// ──────────────────────────────────────────────────────────────────────────────

type PreviewAlternative = { key: string; text: string; isCorrect: boolean };

/** `content.stem` si existe y es string; `null` en otro caso. */
function extractStem(content: unknown): string | null {
  if (content && typeof content === 'object' && 'stem' in content) {
    const stem = (content as { stem?: unknown }).stem;
    if (typeof stem === 'string') return stem;
  }
  return null;
}

/**
 * `content.alternatives` como lista `{key,text,isCorrect}`. Solo los tipos con
 * alternativas (`multiple_choice`, `listening`) las traen; el resto degrada a `null`.
 */
function extractAlternatives(content: unknown): PreviewAlternative[] | null {
  if (!content || typeof content !== 'object' || !('alternatives' in content)) {
    return null;
  }
  const raw = (content as { alternatives?: unknown }).alternatives;
  if (!Array.isArray(raw)) return null;

  const parsed: PreviewAlternative[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { key, text, isCorrect } = entry as {
      key?: unknown;
      text?: unknown;
      isCorrect?: unknown;
    };
    if (typeof key === 'string' && typeof text === 'string' && typeof isCorrect === 'boolean') {
      parsed.push({ key, text, isCorrect });
    }
  }
  return parsed.length > 0 ? parsed : null;
}

/** Clave correcta: primera alternativa con `isCorrect=true`. `null` si no aplica. */
function extractCorrectKey(alternatives: PreviewAlternative[] | null): string | null {
  if (!alternatives) return null;
  const correct = alternatives.find((alt) => alt.isCorrect);
  return correct ? correct.key : null;
}

/** `content.explanation` si existe y es string; `null` en otro caso. */
function extractExplanation(content: unknown): string | null {
  if (content && typeof content === 'object' && 'explanation' in content) {
    const explanation = (content as { explanation?: unknown }).explanation;
    if (typeof explanation === 'string') return explanation;
  }
  return null;
}
