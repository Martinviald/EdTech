import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { organizations } from '@soe/db';
import {
  orgConfigSchema,
  type OrgReviewSettings,
  type OrgReviewSettingsResponse,
  type UpdateOrgReviewSettingsDto,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';

@Injectable()
export class ReviewSettingsService {
  constructor(@InjectDb() private readonly db: Database) {}

  async getSettings(orgId: string): Promise<OrgReviewSettingsResponse> {
    const [org] = await this.db
      .select({ id: organizations.id, config: organizations.config })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    if (!org) throw new NotFoundException('Organización no encontrada');

    return { orgId: org.id, review: this.parseReview(org.config) };
  }

  async updateSettings(
    orgId: string,
    dto: UpdateOrgReviewSettingsDto,
  ): Promise<OrgReviewSettingsResponse> {
    const [org] = await this.db
      .select({ config: organizations.config })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    if (!org) throw new NotFoundException('Organización no encontrada');

    const currentConfig = (org.config ?? {}) as Record<string, unknown>;
    const review = this.mergeReview(this.parseReview(org.config), dto);
    await this.db
      .update(organizations)
      .set({ config: { ...currentConfig, review }, updatedAt: new Date() })
      .where(eq(organizations.id, orgId));

    return this.getSettings(orgId);
  }

  private parseReview(config: unknown): OrgReviewSettings {
    const parsed = orgConfigSchema.safeParse(config ?? {});
    return parsed.success ? (parsed.data.review ?? {}) : {};
  }

  private mergeReview(
    current: OrgReviewSettings,
    dto: UpdateOrgReviewSettingsDto,
  ): OrgReviewSettings {
    const merged: OrgReviewSettings = { ...current };
    if (dto.quickConfirm !== undefined) merged.quickConfirm = dto.quickConfirm;
    if (dto.autoAnnulMinConfidence === null) {
      delete merged.autoAnnulMinConfidence;
    } else if (dto.autoAnnulMinConfidence !== undefined) {
      merged.autoAnnulMinConfidence = dto.autoAnnulMinConfidence;
    }
    return merged;
  }
}
