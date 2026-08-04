import { ForbiddenException, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { organizations, orgBenchmarkSettings, withOrgContext } from '@soe/db';
import type { BenchmarkSettingsModel, UpdateBenchmarkSettingsDto } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';

/**
 * H19.24 — Participación en benchmarking. Una fila por org en
 * `org_benchmark_settings` (RLS por org_id → SIEMPRE `withOrgContext`).
 *
 * `networkOrgId` (red/sostenedor) NO se almacena: se DERIVA de
 * `organizations.parent_id` cuando el padre es una `foundation`. `organizations`
 * NO está bajo RLS → ese lookup va directo con `this.db`.
 *
 * El `orgId` SIEMPRE viene del token (`user.orgId`), nunca del body/query.
 */
@Injectable()
export class BenchmarkSettingsService {
  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * GET /benchmark-settings
   * Lee la fila de la org; si no existe la crea con defaults (opt-in por
   * defecto → `optOutGlobalPool = false`). Devuelve el modelo con `networkOrgId`
   * derivado.
   */
  async getForOrg(user: JwtPayload): Promise<BenchmarkSettingsModel> {
    const orgId = this.requireOrgId(user);

    const row = await withOrgContext(this.db, orgId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(orgBenchmarkSettings)
        .where(eq(orgBenchmarkSettings.orgId, orgId))
        .limit(1);

      if (existing) return existing;

      const [created] = await tx
        .insert(orgBenchmarkSettings)
        .values({ orgId, optOutGlobalPool: false })
        .returning();

      return created;
    });

    const networkOrgId = await this.deriveNetworkOrgId(orgId);
    return this.toModel(row, networkOrgId);
  }

  /**
   * PATCH /benchmark-settings
   * Setea `optOutGlobalPool`. Sella el consentimiento (`consentGrantedAt` +
   * `consentGrantedById`) la primera vez que se registra, sin sobrescribirlo en
   * llamados posteriores.
   */
  async update(
    user: JwtPayload,
    dto: UpdateBenchmarkSettingsDto,
  ): Promise<BenchmarkSettingsModel> {
    const orgId = this.requireOrgId(user);

    const row = await withOrgContext(this.db, orgId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(orgBenchmarkSettings)
        .where(eq(orgBenchmarkSettings.orgId, orgId))
        .limit(1);

      const now = new Date();

      if (!existing) {
        const [created] = await tx
          .insert(orgBenchmarkSettings)
          .values({
            orgId,
            optOutGlobalPool: dto.optOutGlobalPool,
            consentGrantedAt: now,
            consentGrantedById: user.userId,
          })
          .returning();
        return created;
      }

      const [updated] = await tx
        .update(orgBenchmarkSettings)
        .set({
          optOutGlobalPool: dto.optOutGlobalPool,
          updatedAt: now,
          // Sella el consentimiento solo si aún no hay uno.
          ...(existing.consentGrantedAt
            ? {}
            : { consentGrantedAt: now, consentGrantedById: user.userId }),
        })
        .where(eq(orgBenchmarkSettings.orgId, orgId))
        .returning();

      return updated;
    });

    const networkOrgId = await this.deriveNetworkOrgId(orgId);
    return this.toModel(row, networkOrgId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  private requireOrgId(user: JwtPayload): string {
    if (user.orgId === null) {
      throw new ForbiddenException('Usuario sin organización activa');
    }
    return user.orgId;
  }

  /**
   * Deriva la red/sostenedor: si la org tiene `parentId` y ese padre es una
   * `foundation`, `networkOrgId = parentId`; en caso contrario `null`.
   * `organizations` NO está bajo RLS → query directa con `this.db`.
   */
  private async deriveNetworkOrgId(orgId: string): Promise<string | null> {
    const [org] = await this.db
      .select({ parentId: organizations.parentId })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!org?.parentId) return null;

    const [parent] = await this.db
      .select({ id: organizations.id, type: organizations.type })
      .from(organizations)
      .where(eq(organizations.id, org.parentId))
      .limit(1);

    return parent && parent.type === 'foundation' ? parent.id : null;
  }

  private toModel(
    row: {
      orgId: string;
      optOutGlobalPool: boolean;
      consentGrantedAt: Date | null;
      updatedAt: Date;
    },
    networkOrgId: string | null,
  ): BenchmarkSettingsModel {
    return {
      orgId: row.orgId,
      optOutGlobalPool: row.optOutGlobalPool,
      consentGrantedAt: row.consentGrantedAt ? row.consentGrantedAt.toISOString() : null,
      networkOrgId,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
