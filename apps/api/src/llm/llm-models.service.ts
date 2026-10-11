import {
  ConflictException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { llmModels, type LlmModelRow, type NewLlmModelRow } from '@soe/db';
import {
  LLM_FALLBACK_MAX_TOKENS,
  LLM_PROVIDERS,
  type CreateLlmModelDto,
  type LlmModel,
  type LlmModelListResponse,
  type LlmModelOption,
  type LlmProviderId,
  type UpdateLlmModelDto,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import { reportServerError } from '../common/observability/report-error';
import { setCatalogTariffs, type LlmModelTariff } from './llm.pricing';

const CACHE_TTL_MS = 60_000;
const UNIQUE_VIOLATION = '23505';

interface CatalogSnapshot {
  loadedAt: number;
  rows: LlmModelRow[];
  byKey: Map<string, LlmModelRow>;
}

@Injectable()
export class LlmModelsService implements OnModuleInit {
  private snapshot: CatalogSnapshot | null = null;
  private pending: Promise<CatalogSnapshot> | null = null;
  private generation = 0;

  constructor(@InjectDb() private readonly db: Database) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.loadSnapshot();
    } catch (error) {
      reportServerError(error, { scope: 'LlmModelsService.onModuleInit' });
    }
  }

  async listAll(): Promise<LlmModelListResponse> {
    const { rows } = await this.loadSnapshot();
    const data = rows.map((row) => this.toModel(row));
    return { data, total: data.length, page: 1, limit: data.length };
  }

  async listEnabledByProvider(): Promise<Record<LlmProviderId, LlmModelOption[]>> {
    const { rows } = await this.freshSnapshot();
    const byProvider = Object.fromEntries(
      LLM_PROVIDERS.map((provider) => [provider, [] as LlmModelOption[]]),
    ) as Record<LlmProviderId, LlmModelOption[]>;
    for (const row of rows) {
      if (!this.isSelectable(row)) continue;
      byProvider[row.provider]?.push({
        id: row.modelId,
        label: row.label,
        maxTokens: row.maxOutputTokens,
        multimodal: row.supportsImages,
      });
    }
    return byProvider;
  }

  async findModel(provider: LlmProviderId, modelId: string): Promise<LlmModel | undefined> {
    const { byKey } = await this.freshSnapshot();
    const row = byKey.get(this.key(provider, modelId));
    return row ? this.toModel(row) : undefined;
  }

  async findSelectableModel(
    provider: LlmProviderId,
    modelId: string,
  ): Promise<LlmModel | undefined> {
    const { byKey } = await this.freshSnapshot();
    const row = byKey.get(this.key(provider, modelId));
    return row && this.isSelectable(row) ? this.toModel(row) : undefined;
  }

  async resolveMaxTokens(provider: LlmProviderId, modelId: string): Promise<number> {
    const model = await this.findModel(provider, modelId);
    return model?.maxOutputTokens ?? LLM_FALLBACK_MAX_TOKENS;
  }

  async create(dto: CreateLlmModelDto): Promise<LlmModel> {
    try {
      const [row] = await this.db
        .insert(llmModels)
        .values({
          provider: dto.provider,
          modelId: dto.modelId,
          label: dto.label,
          maxOutputTokens: dto.maxOutputTokens,
          supportsImages: dto.supportsImages,
          supportsStructuredOutput: dto.supportsStructuredOutput,
          supportsBatch: dto.supportsBatch,
          inputUsdPerMtok: this.toDecimal(dto.inputUsdPerMtok),
          outputUsdPerMtok: this.toDecimal(dto.outputUsdPerMtok),
          cachedInputUsdPerMtok: this.toNullableDecimal(dto.cachedInputUsdPerMtok),
          batchDiscount: this.toNullableDecimal(dto.batchDiscount, 3),
          enabled: dto.enabled,
        })
        .returning();
      if (!row) throw new Error('El alta del modelo no devolvió la fila creada');
      this.invalidate();
      return this.toModel(row);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          `El modelo "${dto.modelId}" ya existe en el catálogo de ${dto.provider}`,
        );
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateLlmModelDto): Promise<LlmModel> {
    const [row] = await this.db
      .update(llmModels)
      .set({ ...this.toUpdateValues(dto), updatedAt: new Date() })
      .where(eq(llmModels.id, id))
      .returning();
    if (!row) throw new NotFoundException('El modelo no existe en el catálogo');
    this.invalidate();
    return this.toModel(row);
  }

  private toUpdateValues(dto: UpdateLlmModelDto): Partial<NewLlmModelRow> {
    const values: Partial<NewLlmModelRow> = {};
    if (dto.label !== undefined) values.label = dto.label;
    if (dto.maxOutputTokens !== undefined) values.maxOutputTokens = dto.maxOutputTokens;
    if (dto.supportsImages !== undefined) values.supportsImages = dto.supportsImages;
    if (dto.supportsStructuredOutput !== undefined) {
      values.supportsStructuredOutput = dto.supportsStructuredOutput;
    }
    if (dto.supportsBatch !== undefined) values.supportsBatch = dto.supportsBatch;
    if (dto.inputUsdPerMtok !== undefined) {
      values.inputUsdPerMtok = this.toDecimal(dto.inputUsdPerMtok);
    }
    if (dto.outputUsdPerMtok !== undefined) {
      values.outputUsdPerMtok = this.toDecimal(dto.outputUsdPerMtok);
    }
    if (dto.cachedInputUsdPerMtok !== undefined) {
      values.cachedInputUsdPerMtok = this.toNullableDecimal(dto.cachedInputUsdPerMtok);
    }
    if (dto.batchDiscount !== undefined) {
      values.batchDiscount = this.toNullableDecimal(dto.batchDiscount, 3);
    }
    if (dto.enabled !== undefined) values.enabled = dto.enabled;
    if (dto.deprecated !== undefined) values.deprecatedAt = dto.deprecated ? new Date() : null;
    return values;
  }

  private async freshSnapshot(): Promise<CatalogSnapshot> {
    if (this.snapshot && Date.now() - this.snapshot.loadedAt < CACHE_TTL_MS) {
      return this.snapshot;
    }
    return this.loadSnapshot();
  }

  private loadSnapshot(): Promise<CatalogSnapshot> {
    if (this.pending) return this.pending;
    const pending = this.querySnapshot(this.generation).finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    this.pending = pending;
    return pending;
  }

  private async querySnapshot(generation: number): Promise<CatalogSnapshot> {
    const rows = await this.db
      .select()
      .from(llmModels)
      .orderBy(asc(llmModels.provider), asc(llmModels.label));
    const byKey = new Map(rows.map((row) => [this.key(row.provider, row.modelId), row]));
    const tariffs = new Map<string, LlmModelTariff>(
      rows.map((row) => [row.modelId, this.toTariff(row)]),
    );
    const snapshot: CatalogSnapshot = { loadedAt: Date.now(), rows, byKey };
    if (generation === this.generation) {
      setCatalogTariffs(tariffs);
      this.snapshot = snapshot;
    }
    return snapshot;
  }

  private invalidate(): void {
    this.generation += 1;
    this.snapshot = null;
    this.pending = null;
    void this.loadSnapshot().catch((error: unknown) => {
      reportServerError(error, { scope: 'LlmModelsService.invalidate' });
    });
  }

  private isSelectable(row: LlmModelRow): boolean {
    return row.enabled && row.deprecatedAt === null;
  }

  private key(provider: string, modelId: string): string {
    return `${provider}:${modelId}`;
  }

  private toTariff(row: LlmModelRow): LlmModelTariff {
    return {
      inputUsdPerMtok: Number(row.inputUsdPerMtok),
      outputUsdPerMtok: Number(row.outputUsdPerMtok),
      cachedInputUsdPerMtok:
        row.cachedInputUsdPerMtok === null ? null : Number(row.cachedInputUsdPerMtok),
    };
  }

  private toModel(row: LlmModelRow): LlmModel {
    return {
      id: row.id,
      provider: row.provider,
      modelId: row.modelId,
      label: row.label,
      maxOutputTokens: row.maxOutputTokens,
      supportsImages: row.supportsImages,
      supportsStructuredOutput: row.supportsStructuredOutput,
      supportsBatch: row.supportsBatch,
      inputUsdPerMtok: Number(row.inputUsdPerMtok),
      outputUsdPerMtok: Number(row.outputUsdPerMtok),
      cachedInputUsdPerMtok:
        row.cachedInputUsdPerMtok === null ? null : Number(row.cachedInputUsdPerMtok),
      batchDiscount: row.batchDiscount === null ? null : Number(row.batchDiscount),
      enabled: row.enabled,
      deprecatedAt: row.deprecatedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDecimal(value: number, fractionDigits = 6): string {
    return value.toFixed(fractionDigits);
  }

  private toNullableDecimal(value: number | null, fractionDigits = 6): string | null {
    return value === null ? null : this.toDecimal(value, fractionDigits);
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: unknown }).code === UNIQUE_VIOLATION
    );
  }
}
