import { z } from 'zod';

// ── Niveles/umbrales de logro por instrumento (performance_bands) ─────────────
// Cada instrumento puede definir su propio conjunto de niveles (DIA: 3 = I/II/III;
// Cambridge: 6 CEFR; etc.) con umbrales de corte propios sobre el % de logro
// (0..1). Las bandas de un instrumento oficial son globales (org_id NULL) y las
// comparten todas las organizaciones que usan ese instrumento. Ver
// docs/analisis-clasificacion-niveles-dia.md.

const threshold = z.coerce.number().min(0).max(1);

// Una banda individual dentro del set de un instrumento.
export const performanceBandItemSchema = z.object({
  key: z.string().min(1).max(50),
  label: z.string().min(1).max(120),
  order: z.coerce.number().int().min(0),
  // Rango [minThreshold, maxThreshold): min inclusivo, max exclusivo (salvo la
  // banda superior, cuyo max=1 es inclusivo para cubrir p=1.0).
  minThreshold: threshold,
  maxThreshold: threshold,
  color: z.string().max(50).nullish(),
});
export type PerformanceBandItemDto = z.infer<typeof performanceBandItemSchema>;

/**
 * Upsert del set COMPLETO de bandas de un instrumento (reemplazo atómico). El set
 * debe cubrir [0,1] sin huecos ni solapes: ordenado por `order`, la primera banda
 * arranca en 0, la última termina en 1, y `maxThreshold` de cada banda coincide
 * con `minThreshold` de la siguiente. Los `order` deben ser estrictamente
 * crecientes.
 */
export const upsertInstrumentBandsSchema = z
  .object({
    bands: z.array(performanceBandItemSchema).min(1).max(12),
  })
  .superRefine((val, ctx) => {
    const bands = [...val.bands].sort((a, b) => a.order - b.order);

    // Órdenes estrictamente crecientes (sin duplicados).
    for (let i = 1; i < bands.length; i++) {
      if (bands[i]!.order === bands[i - 1]!.order) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Órdenes de banda duplicados: ${bands[i]!.order}`,
          path: ['bands'],
        });
      }
    }

    // Cada banda: min < max.
    for (const b of bands) {
      if (b.minThreshold >= b.maxThreshold) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Banda '${b.key}': minThreshold (${b.minThreshold}) debe ser < maxThreshold (${b.maxThreshold})`,
          path: ['bands'],
        });
      }
    }

    // Cobertura contigua [0,1] sin huecos ni solapes.
    const EPS = 1e-6;
    if (Math.abs(bands[0]!.minThreshold - 0) > EPS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La primera banda debe arrancar en minThreshold = 0',
        path: ['bands'],
      });
    }
    if (Math.abs(bands[bands.length - 1]!.maxThreshold - 1) > EPS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La última banda debe terminar en maxThreshold = 1',
        path: ['bands'],
      });
    }
    for (let i = 1; i < bands.length; i++) {
      if (Math.abs(bands[i]!.minThreshold - bands[i - 1]!.maxThreshold) > EPS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Hueco o solape entre '${bands[i - 1]!.key}' (max ${bands[i - 1]!.maxThreshold}) y '${bands[i]!.key}' (min ${bands[i]!.minThreshold})`,
          path: ['bands'],
        });
      }
    }
  });
export type UpsertInstrumentBandsDto = z.infer<typeof upsertInstrumentBandsSchema>;

export const performanceBandListQuerySchema = z.object({
  instrumentId: z.string().uuid(),
});
export type PerformanceBandListQueryDto = z.infer<typeof performanceBandListQuerySchema>;

// ── Response Models ──────────────────────────────────────────────────────────

export type PerformanceBandResponseModel = {
  id: string;
  instrumentId: string | null;
  scaleId: string | null;
  orgId: string | null;
  key: string;
  label: string;
  order: number;
  minThreshold: string;
  maxThreshold: string;
  color: string | null;
  // Es banda global (orgId null) o de la org del usuario.
  isGlobal: boolean;
};

export type PerformanceBandListResponse = {
  data: PerformanceBandResponseModel[];
  instrumentId: string;
  total: number;
};

// Vista mínima de una banda para adjuntar a un resultado (assessment/skill) y
// que la UI muestre el nivel real del instrumento (ej. DIA I/II/III) en lugar
// del enum legacy de 4 niveles. `null` en el resultado → usar el enum legacy.
export type PerformanceBandView = {
  key: string;
  label: string;
  order: number;
  color?: string | null;
};
