import { cache } from 'react';

import type { AssessmentListResponse } from '@soe/types';
import { apiGet } from '@/lib/api';
import { listClassGroupsForUser, type ClassGroupForUser } from '@/lib/teacherAssignmentsApi';

export type OrgOverview = {
  isSetupComplete: boolean;
  classGroupCount: number;
  academicYear: { year: number } | null;
};

export const getOrgOverview = cache(() =>
  apiGet<OrgOverview>('/organizations/me/overview').catch(() => null),
);

export const getAssessments = cache(() =>
  apiGet<AssessmentListResponse>('/item-analysis/assessments').catch(() => null),
);

export const getInstrumentsTotal = cache(() =>
  apiGet<{ total: number }>('/instruments?limit=1').catch(() => null),
);

export const getClassGroupsForUser = cache((orgId: string) =>
  listClassGroupsForUser(orgId).catch((): ClassGroupForUser[] => []),
);
