import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { itemEditProposals, withOrgContext, type ItemEditProposal } from '@soe/db';
import {
  validateItemContent,
  type ItemContent,
  type ItemEditProposalAuthor,
  type ItemEditProposalModel,
  type ItemEditProposalStatus,
  type ItemType,
  type ListItemEditProposalsQueryDto,
  type ProposeItemEditDto,
  type ReviewItemEditProposalDto,
} from '@soe/types';
import { ZodError } from 'zod';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { ItemsService } from '../items/items.service';
import { LlmService } from '../llm/llm.service';
import { estimateLlmCostUsd } from '../llm/llm.pricing';
import { ITEM_EDIT_PROMPT_VERSION, ITEM_EDIT_SYSTEM_PROMPT } from './item-edit-proposals.constants';

/**
 * Propuestas de edición de ítems (TKT-19 — escritura asistida por IA).
 *
 * Materializa el principio §8.3 del proyecto: **la IA propone, el humano aprueba**.
 * `propose()` usa el LLM para generar un `content` reescrito y lo guarda en
 * `pending` — SIN tocar el ítem. `review()` APLICA (approve) la propuesta al ítem
 * real vía `ItemsService.update` (que versiona el cambio) o la marca `rejected`.
 * La evidencia IA (`proposedContent`) y el snapshot previo (`currentContent`)
 * nunca se sobrescriben.
 *
 * Toda query a `item_edit_proposals` corre dentro de `withOrgContext` (RLS por
 * `org_id`); el `orgId` sale SIEMPRE del token (`user.orgId`), nunca del body.
 */
@Injectable()
export class ItemEditProposalsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly items: ItemsService,
    private readonly llm: LlmService,
  ) {}

  /**
   * Genera una propuesta de edición para un ítem y la persiste en `pending`.
   * Pasos: (1) carga el ítem verificando permiso de EDICIÓN (org propia, no
   * oficial); (2) pide al LLM el `content` reescrito según `instruction`; (3)
   * valida la salida contra el schema Zod del tipo del ítem; (4) inserta la
   * propuesta. NUNCA modifica el ítem aquí.
   *
   * @param author 'ai' (asistente) por defecto; 'human' si es edición manual con
   *   el mismo flujo de aprobación.
   */
  async propose(
    user: JwtPayload,
    dto: ProposeItemEditDto,
    author: ItemEditProposalAuthor = 'ai',
  ): Promise<ItemEditProposalModel> {
    const orgId = this.requireOrgId(user);

    // Permiso de edición + snapshot del contenido actual (evidencia del diff).
    const item = await this.items.getEditableItem(dto.itemId, user);
    const itemType = item.type as ItemType;
    const currentContent = (item.content ?? null) as ItemContent | null;

    // El LLM propone el nuevo `content`; validamos contra el tipo del ítem.
    const generated = await this.generateProposedContent(
      orgId,
      itemType,
      currentContent,
      dto.instruction,
    );

    return withOrgContext(this.db, orgId, async (tx) => {
      const [row] = await tx
        .insert(itemEditProposals)
        .values({
          orgId,
          itemId: dto.itemId,
          status: 'pending',
          author,
          itemType,
          instruction: dto.instruction,
          reasoning: generated.reasoning,
          currentContent,
          proposedContent: generated.content,
          model: generated.model,
          promptVersion: ITEM_EDIT_PROMPT_VERSION,
          tokens: generated.tokens,
          costUsd: generated.costUsd,
          createdById: user.userId,
        })
        .returning();

      if (!row) {
        throw new BadRequestException('No se pudo crear la propuesta de edición');
      }
      return toModel(row);
    });
  }

  /** Lista las propuestas de un ítem del tenant (más recientes primero). */
  async listForItem(
    user: JwtPayload,
    query: ListItemEditProposalsQueryDto,
  ): Promise<ItemEditProposalModel[]> {
    const orgId = this.requireOrgId(user);
    return withOrgContext(this.db, orgId, async (tx) => {
      const conditions = [
        eq(itemEditProposals.orgId, orgId),
        eq(itemEditProposals.itemId, query.itemId),
      ];
      if (query.status) {
        conditions.push(eq(itemEditProposals.status, query.status));
      }
      const rows = await tx
        .select()
        .from(itemEditProposals)
        .where(and(...conditions))
        .orderBy(desc(itemEditProposals.createdAt));
      return rows.map(toModel);
    });
  }

  /** Devuelve una propuesta por id dentro del tenant. */
  async get(user: JwtPayload, id: string): Promise<ItemEditProposalModel> {
    const orgId = this.requireOrgId(user);
    return withOrgContext(this.db, orgId, async (tx) => {
      const row = await this.findOne(tx, id, orgId);
      if (!row) throw new NotFoundException('Propuesta no encontrada');
      return toModel(row);
    });
  }

  /**
   * Revisión humana (§8.3): aprobar o rechazar una propuesta `pending`.
   * - `approve` → APLICA `proposedContent` al ítem real vía `ItemsService.update`
   *   (valida el contenido, versiona y snapshotea el ítem previo) y marca la
   *   propuesta `approved` sellando `appliedVersion`/`reviewedById`.
   * - `reject` → marca `rejected`, sin tocar el ítem.
   * En ambos casos se re-verifica el permiso de EDICIÓN del ítem (el guard de rol
   * ya cubre el rol; esto cubre pertenencia org / ítem oficial de solo lectura).
   */
  async review(
    user: JwtPayload,
    id: string,
    dto: ReviewItemEditProposalDto,
  ): Promise<ItemEditProposalModel> {
    const orgId = this.requireOrgId(user);

    // 1) Cargar la propuesta y validar estado, dentro del contexto RLS.
    const proposal = await withOrgContext(this.db, orgId, async (tx) => {
      const row = await this.findOne(tx, id, orgId);
      if (!row) throw new NotFoundException('Propuesta no encontrada');
      if (row.status !== 'pending') {
        throw new BadRequestException(
          `Solo se puede revisar una propuesta en estado "pending" (actual: "${row.status}")`,
        );
      }
      return row;
    });

    if (dto.action === 'reject') {
      return this.finishReview(orgId, id, user.userId, 'rejected', null);
    }

    // approve: verificar permiso de edición y APLICAR al ítem real. `items` no es
    // tabla RLS, por eso `ItemsService.update` corre fuera del `withOrgContext`.
    await this.items.getEditableItem(proposal.itemId, user);
    const content = this.validateForType(proposal.itemType as ItemType, proposal.proposedContent);
    const updated = await this.items.update(proposal.itemId, { content }, user);

    return this.finishReview(orgId, id, user.userId, 'approved', updated?.version ?? null);
  }

  // ---------- helpers ----------

  /** Persiste el desenlace de la revisión (approved/rejected) y devuelve el modelo. */
  private async finishReview(
    orgId: string,
    id: string,
    reviewerId: string,
    status: Extract<ItemEditProposalStatus, 'approved' | 'rejected'>,
    appliedVersion: number | null,
  ): Promise<ItemEditProposalModel> {
    return withOrgContext(this.db, orgId, async (tx) => {
      await tx
        .update(itemEditProposals)
        .set({
          status,
          appliedVersion,
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(itemEditProposals.id, id), eq(itemEditProposals.orgId, orgId)));

      const row = await this.findOne(tx, id, orgId);
      if (!row) throw new NotFoundException('Propuesta no encontrada');
      return toModel(row);
    });
  }

  /**
   * Llama al LLM para reescribir el `content` del ítem según `instruction` y valida
   * su salida contra el schema del tipo. La feature de configuración es `assistant`
   * (esta es una capacidad del asistente). Si el modelo no devuelve JSON parseable
   * o el content no valida, lanza `BadRequestException` (no persiste nada).
   */
  private async generateProposedContent(
    orgId: string,
    itemType: ItemType,
    currentContent: ItemContent | null,
    instruction: string,
  ): Promise<{
    content: ItemContent;
    reasoning: string | null;
    model: string | null;
    tokens: { input: number; output: number } | null;
    costUsd: string | null;
  }> {
    const prompt = [
      `Tipo de ítem: ${itemType}`,
      '',
      'Contenido actual del ítem (JSON):',
      JSON.stringify(currentContent ?? {}, null, 2),
      '',
      'Instrucción del editor humano:',
      instruction,
      '',
      'Devuelve el JSON con "reasoning" y "content" (content completo reescrito).',
    ].join('\n');

    const result = await this.llm.completeWithUsage(
      ITEM_EDIT_SYSTEM_PROMPT,
      prompt,
      orgId,
      'assistant',
    );

    const parsed = parseLlmJson(result.text);
    if (!parsed) {
      throw new BadRequestException(
        'La IA no devolvió una propuesta con formato válido. Intenta reformular la instrucción.',
      );
    }

    const content = this.validateForType(itemType, parsed.content);
    const tokens = result.usage
      ? { input: result.usage.inputTokens, output: result.usage.outputTokens }
      : null;
    const costUsd = result.usage ? estimateLlmCostUsd(result.model, result.usage) : null;

    return {
      content,
      reasoning: parsed.reasoning,
      model: result.model,
      tokens,
      costUsd,
    };
  }

  /** Valida un `content` contra el schema Zod de su tipo (traduce ZodError a 400). */
  private validateForType(type: ItemType, content: unknown): ItemContent {
    try {
      return validateItemContent(type, content);
    } catch (error) {
      if (error instanceof ZodError) {
        const detail = error.issues
          .map((i) => `${i.path.length ? `${i.path.join('.')}: ` : ''}${i.message}`)
          .join('; ');
        throw new BadRequestException(
          `El contenido propuesto no es válido para el tipo "${type}": ${detail}`,
        );
      }
      throw error;
    }
  }

  private async findOne(
    tx: Database,
    id: string,
    orgId: string,
  ): Promise<ItemEditProposal | undefined> {
    const [row] = await tx
      .select()
      .from(itemEditProposals)
      .where(and(eq(itemEditProposals.id, id), eq(itemEditProposals.orgId, orgId)))
      .limit(1);
    return row;
  }

  private requireOrgId(user: JwtPayload): string {
    if (!user.orgId) {
      throw new ForbiddenException('Usuario sin organización activa');
    }
    return user.orgId;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers puros
// ─────────────────────────────────────────────────────────────────────────────

/** Mapea la fila Drizzle al modelo del contrato compartido. */
function toModel(row: ItemEditProposal): ItemEditProposalModel {
  return {
    id: row.id,
    itemId: row.itemId,
    status: row.status,
    author: row.author,
    itemType: row.itemType as ItemType,
    instruction: row.instruction,
    reasoning: row.reasoning,
    currentContent: (row.currentContent ?? null) as ItemContent | null,
    proposedContent: row.proposedContent as ItemContent,
    appliedVersion: row.appliedVersion,
    model: row.model,
    promptVersion: row.promptVersion,
    costUsd: row.costUsd,
    createdById: row.createdById,
    reviewedById: row.reviewedById,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
  };
}

/**
 * Extrae el objeto `{ reasoning, content }` de la respuesta del LLM. Tolera cercas
 * de código (```json …```) y texto residual buscando el primer objeto JSON. `content`
 * es obligatorio (objeto); `reasoning` es opcional (string). Devuelve null si no se
 * puede parsear un content utilizable.
 */
export function parseLlmJson(text: string): { content: unknown; reasoning: string | null } | null {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  const candidate = extractFirstJsonObject(stripped);
  if (!candidate) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== 'object') return null;

  const record = obj as Record<string, unknown>;
  const content = record.content;
  if (content === null || typeof content !== 'object') return null;

  const reasoning = typeof record.reasoning === 'string' ? record.reasoning : null;
  return { content, reasoning };
}

/** Devuelve el substring del primer objeto JSON balanceado, o null. */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
