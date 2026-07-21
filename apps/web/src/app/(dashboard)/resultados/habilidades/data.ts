import { cache } from 'react';

import { apiGet } from '@/lib/api';
import type { DashboardSkillsResponse } from '@soe/types';

export const getDashboardSkills = cache((query: string) =>
  apiGet<DashboardSkillsResponse>(`/dashboards/skills${query}`),
);
