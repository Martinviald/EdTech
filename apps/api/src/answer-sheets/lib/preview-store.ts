import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { AnswerSheetColumnMapping, AnswerSheetFormat } from '@soe/types';
import type { ParsedAnswerSheetRow } from './parsers/parser.types';

/**
 * Cache en memoria de previsualizaciones de hojas de respuesta.
 *
 * Diseño:
 *  - Cada `upload` genera un `previewToken` UUID v4 y guarda el parseo.
 *  - `preview` y `confirm` leen del store usando el token.
 *  - TTL: 30 minutos. La purga es lazy: cada lectura limpia entradas expiradas.
 *  - **No persiste a Redis** — en F1 alcanza con memoria del proceso. Cuando
 *    el módulo crezca a multi-instancia (F3+ con BullMQ/Redis), reemplazar
 *    esta clase manteniendo la misma interfaz.
 *
 * Multi-tenancy: el `orgId` se guarda dentro de cada entry para que el
 * service rechace tokens robados por otro tenant.
 */

export interface PreviewStoreEntry {
  previewToken: string;
  orgId: string;
  userId: string;
  format: AnswerSheetFormat;
  instrumentId: string;
  classGroupId: string | null;
  assessmentId: string | null;
  assessmentName: string | null;
  columnMapping: AnswerSheetColumnMapping | null;
  rows: ParsedAnswerSheetRow[];
  detectedColumns: string[];
  warnings: string[];
  createdAt: Date;
  expiresAt: Date;
}

export const PREVIEW_TTL_MS = 30 * 60 * 1000; // 30 min

@Injectable()
export class AnswerSheetPreviewStore {
  private readonly entries = new Map<string, PreviewStoreEntry>();

  set(
    payload: Omit<PreviewStoreEntry, 'previewToken' | 'createdAt' | 'expiresAt'>,
  ): PreviewStoreEntry {
    this.purgeExpired();
    const now = new Date();
    const entry: PreviewStoreEntry = {
      ...payload,
      previewToken: randomUUID(),
      createdAt: now,
      expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS),
    };
    this.entries.set(entry.previewToken, entry);
    return entry;
  }

  get(token: string): PreviewStoreEntry | null {
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
