import { cache } from 'react';

import { apiGet } from '@/lib/api';
import type {
  AssessmentListResponse,
  ComparableOverviewResponse,
  DashboardFilterOptionsResponse,
} from '@soe/types';

export const getEvaluacionesFilters = cache((query: string) =>
  apiGet<DashboardFilterOptionsResponse>(`/dashboards/filters${query}`),
);

export const getEvaluacionesAssessments = cache((query: string) =>
  apiGet<AssessmentListResponse>(`/item-analysis/assessments${query}`),
);

/**
 * Las unidades comparables del mismo alcance, de donde sale la gravedad de cada
 * evaluación (`ComparableUnitSummary.assessmentIds` es el puente).
 *
 * Se pide acá en vez de calcularla en el backend de la lista para no acoplar
 * `ItemAnalysisService` al armado de unidades: la severidad ya la resuelve este
 * endpoint, con los cortes de cada instrumento, y duplicar ese criterio en una
 * consulta propia es exactamente cómo se desincronizan dos definiciones de lo
 * mismo. Ver docs/diseno-entrada-por-proceso.md §D5.
 */
export const getEvaluacionesComparable = cache((query: string) =>
  apiGet<ComparableOverviewResponse>(`/dashboards/comparable-overview${query}`),
);
