import type { Route } from 'next';
import type { SheetScanBatchStatus } from '@soe/types';
import type { StatusTone } from '@/components/shared';

/**
 * Rutas de las vistas de escaneo (D1). Locales a este workstream porque
 * `hojas/lib/routes.ts` es de A2 y no se toca en F2 — en F3 se promueven a
 * `HOJAS_ROUTES`.
 */
export const SCAN_ROUTES = {
  escanear: '/hojas/escanear' as Route,
  revisar: (batchId: string) => `/hojas/lotes/${batchId}/revisar` as Route,
};

export const BATCH_STATUS_META: Record<
  SheetScanBatchStatus,
  { label: string; tone: StatusTone }
> = {
  pending: { label: 'En espera', tone: 'info' },
  processing: { label: 'Procesando', tone: 'info' },
  needs_review: { label: 'Requiere revisión', tone: 'warning' },
  confirmed: { label: 'Confirmado', tone: 'success' },
  failed: { label: 'Falló', tone: 'danger' },
  rejected: { label: 'Rechazado', tone: 'danger' },
};
