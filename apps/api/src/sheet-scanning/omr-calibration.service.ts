import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { organizations } from '@soe/db';
import {
  orgConfigSchema,
  type OmrCalibration,
  type OmrCalibrationResponse,
  type UpdateOmrCalibrationDto,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';

@Injectable()
export class OmrCalibrationService {
  constructor(@InjectDb() private readonly db: Database) {}

  async getCalibration(orgId: string): Promise<OmrCalibrationResponse> {
    const [org] = await this.db
      .select({ id: organizations.id, config: organizations.config })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    if (!org) throw new NotFoundException('Organización no encontrada');

    return { orgId: org.id, calibration: this.parseCalibration(org.config) };
  }

  async updateCalibration(
    orgId: string,
    dto: UpdateOmrCalibrationDto,
  ): Promise<OmrCalibrationResponse> {
    const [org] = await this.db
      .select({ config: organizations.config })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    if (!org) throw new NotFoundException('Organización no encontrada');

    const currentConfig = (org.config ?? {}) as Record<string, unknown>;
    await this.db
      .update(organizations)
      .set({ config: { ...currentConfig, omrCalibration: dto }, updatedAt: new Date() })
      .where(eq(organizations.id, orgId));

    return this.getCalibration(orgId);
  }

  private parseCalibration(config: unknown): OmrCalibration {
    const parsed = orgConfigSchema.safeParse(config ?? {});
    return parsed.success ? (parsed.data.omrCalibration ?? {}) : {};
  }
}
