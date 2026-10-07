import { cache } from 'react';

import { apiGet } from '@/lib/api';
import type { MeasurementProcessListResponse } from '@soe/types';

export const getEstablishmentProcessOptions = cache(() =>
  apiGet<MeasurementProcessListResponse>('/measurement-processes?limit=100').catch(
    (): MeasurementProcessListResponse | null => null,
  ),
);
