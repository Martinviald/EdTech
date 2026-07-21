import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { OfficialReportImportFile } from '@soe/types';

/**
 * Cache en memoria de los informes oficiales subidos, a la espera de confirmación.
 *
 * Mismo diseño que `answer-sheets/lib/preview-store.ts` (upload → preview → confirm
 * con token de un solo uso, TTL 30 min, purga lazy, sin Redis en F1). El `orgId` va
 * dentro de la entrada para que el service rechace un token de otro tenant.
 *
 * Guarda el archivo YA validado por Zod: parsear una vez y que `preview` y `confirm`
 * relean lo mismo. Los gates, en cambio, se recalculan en ambos — dependen de la BD
 * (ítems, tags, nómina), que pudo cambiar entre uno y otro.
 */

export interface OfficialReportPreviewEntry {
  previewToken: string;
  orgId: string;
  userId: string;
  instrumentId: string;
  classGroupId: string;
  assessmentId: string | null;
  assessmentName: string | null;
  file: OfficialReportImportFile;
  createdAt: Date;
  expiresAt: Date;
}

export const OFFICIAL_REPORT_PREVIEW_TTL_MS = 30 * 60 * 1000; // 30 min

@Injectable()
export class OfficialReportPreviewStore {
  private readonly entries = new Map<string, OfficialReportPreviewEntry>();

  set(
    payload: Omit<OfficialReportPreviewEntry, 'previewToken' | 'createdAt' | 'expiresAt'>,
  ): OfficialReportPreviewEntry {
    this.purgeExpired();
    const now = new Date();
    const entry: OfficialReportPreviewEntry = {
      ...payload,
      previewToken: randomUUID(),
      createdAt: now,
      expiresAt: new Date(now.getTime() + OFFICIAL_REPORT_PREVIEW_TTL_MS),
    };
    this.entries.set(entry.previewToken, entry);
    return entry;
  }

  get(token: string): OfficialReportPreviewEntry | null {
    this.purgeExpired();
    const entry = this.entries.get(token);
    if (!entry) return null;
    if (entry.expiresAt.getTime() < Date.now()) {
      this.entries.delete(token);
      return null;
    }
    return entry;
  }

  delete(token: string): void {
    this.entries.delete(token);
  }

  /** Sólo para tests. */
  clear(): void {
    this.entries.clear();
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [token, entry] of this.entries.entries()) {
      if (entry.expiresAt.getTime() < now) {
        this.entries.delete(token);
      }
    }
  }
}
