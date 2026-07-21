import { cache } from 'react';

import { apiGet } from '@/lib/api';
import type {
  DashboardOverviewResponse,
  DashboardFilterOptionsResponse,
  DashboardTeacherKpisResponse,
} from '@soe/types';

// Fetchers del panorama, cacheados por-request (React.cache): si una sección se
// vuelve a montar o varias secciones piden el mismo endpoint con el mismo query,
// el request se deduplica dentro del mismo render del servidor.

export const getDashboardOverview = cache((query: string) =>
  apiGet<DashboardOverviewResponse>(`/dashboards/overview${query}`),
);

export const getDashboardFilters = cache((query: string) =>
  apiGet<DashboardFilterOptionsResponse>(`/dashboards/filters${query}`),
);

export const getDashboardTeacherKpis = cache((query: string) =>
  apiGet<DashboardTeacherKpisResponse>(`/dashboards/teacher-kpis${query}`),
);
