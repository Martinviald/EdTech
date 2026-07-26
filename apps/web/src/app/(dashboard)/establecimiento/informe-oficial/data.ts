import { cache } from 'react';

import { apiGet } from '@/lib/api';
import type {
  DashboardFilterOptionsResponse,
  OfficialEstablishmentReportResponse,
} from '@soe/types';

export const getEstablishmentFilterOptions = cache(() =>
  apiGet<DashboardFilterOptionsResponse>('/dashboards/filters').catch(
    (): DashboardFilterOptionsResponse | null => null,
  ),
);

export const getEstablishmentReport = cache((querySuffix: string) =>
  apiGet<OfficialEstablishmentReportResponse>(`/reports/establishment${querySuffix}`).catch(
    (): OfficialEstablishmentReportResponse | null => null,
  ),
);
