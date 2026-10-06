import { z } from 'zod';

/**
 * Código de una línea de prueba (`M1`, `CIE-COMUN`, `SPEAKING`): mayúsculas, dígitos y
 * guiones. Es el identificador estable con el que los JSON de instrumento declaran su línea.
 */
export const testTrackCodeSchema = z
  .string()
  .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/, 'El código de línea va en mayúsculas, dígitos y guiones');
export type TestTrackCode = z.infer<typeof testTrackCodeSchema>;

/** Una línea oficial del catálogo versionado (`packages/db/data/test-tracks.json`). */
export const testTrackCatalogEntrySchema = z
  .object({
    subjectCode: z.string().min(1),
    code: testTrackCodeSchema,
    name: z.string().min(1),
    shortName: z.string().min(1),
    order: z.number().int().nonnegative(),
  })
  .strict();
export type TestTrackCatalogEntryInput = z.infer<typeof testTrackCatalogEntrySchema>;

export const testTrackCatalogSchema = z
  .object({ tracks: z.array(testTrackCatalogEntrySchema).min(1) })
  .strict()
  .superRefine((catalog, ctx) => {
    const seen = new Set<string>();
    catalog.tracks.forEach((track, index) => {
      const key = `${track.subjectCode}|${track.code}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tracks', index, 'code'],
          message: `La línea ${track.code} está repetida en la asignatura ${track.subjectCode}`,
        });
      }
      seen.add(key);
    });
  });
export type TestTrackCatalogInput = z.infer<typeof testTrackCatalogSchema>;
