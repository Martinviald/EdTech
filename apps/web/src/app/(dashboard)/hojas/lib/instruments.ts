import 'server-only';
import { cache } from 'react';
import type { InstrumentModel, PaginatedResponse } from '@soe/types';
import { apiGet } from '@/lib/api';

/**
 * Listado de instrumentos para el módulo hojas (selector de "Diseñar hoja" y
 * nombres en las tablas del índice). `cache()` deduplica la llamada cuando
 * varias secciones del mismo request la necesitan (rule frontend/05 §3).
 * `pageSize` (no `limit`) es el nombre que valida el DTO del API de
 * instrumentos — mismo detalle que el hub de banco-contenido.
 */
export const listInstrumentsForSheets = cache(async () => {
  return apiGet<PaginatedResponse<InstrumentModel>>('/instruments?page=1&pageSize=100');
});
