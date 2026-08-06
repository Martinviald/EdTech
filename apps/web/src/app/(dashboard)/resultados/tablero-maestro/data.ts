import { cache } from 'react';

import { apiGet } from '@/lib/api';
import type { MasterBoardMatrix, MasterBoardTakesResponse, TeacherPerformance } from '@soe/types';

export const getMasterBoardTakes = cache((query: string) =>
  apiGet<MasterBoardTakesResponse>(`/master-board/takes${query}`),
);

export const getMasterBoardMatrix = cache((query: string) =>
  apiGet<MasterBoardMatrix>(`/master-board/matrix${query}`),
);

export const getTeacherPerformance = cache((userId: string, query: string) =>
  apiGet<TeacherPerformance>(`/master-board/teachers/${userId}/performance${query}`),
);
