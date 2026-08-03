import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const isoDateSchema = z.string().datetime();

/** Entrada de catálogo de referencia (`GET /catalog/subjects`, `GET /catalog/grades`). */
export type CatalogEntryModel = {
  id: string;
  name: string;
  shortName: string;
};

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof paginationSchema>;

/**
 * Envoltura canónica de toda respuesta de lista de la API (CLAUDE.md §6.2:
 * `{ data, total, page, limit }`).
 *
 * Vive acá porque estaba redeclarada a mano en 9 archivos del front, sin nada
 * que verificara que coincidiera con lo que el backend devuelve de verdad. Esa
 * falta de contrato compartido fue lo que dejó pasar un bug real: el front pedía
 * `?limit=200`, el DTO del backend sólo entendía `pageSize`, y la lista se
 * cortaba en 20 de 33 ítems sin que nada fallara.
 *
 * `total` es el total del FILTRO, no el de la página: si `data.length < total`,
 * la respuesta viene truncada y la UI tiene que decirlo.
 */
export type PaginatedResponse<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
};

export const paginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    totalPages: z.number().int(),
  });

/**
 * Filtro multi-valor desde la query string: acepta un param repetido
 * (`?x=a&x=b`) o un CSV en un solo param (`?x=a,b`) y devuelve un array validado
 * (o `undefined` si viene vacío). Mismo contrato que el banco de ítems (T2-13),
 * reutilizado por los filtros multi-select del dashboard (T2-12).
 */
export const csvArraySchema = <T extends z.ZodTypeAny>(item: T) =>
  z
    .union([z.array(z.string()), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const raw = Array.isArray(value) ? value : [value];
      const parts = raw
        .flatMap((entry) => entry.split(','))
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      return parts.length > 0 ? parts : undefined;
    })
    .pipe(z.array(item).optional());

/** CSV/array de UUIDs desde la query string. Ver {@link csvArraySchema}. */
export const uuidCsvSchema = csvArraySchema(z.string().uuid());

/** CSV/array de strings no vacíos desde la query string. Ver {@link csvArraySchema}. */
export const stringCsvSchema = csvArraySchema(z.string().min(1));
