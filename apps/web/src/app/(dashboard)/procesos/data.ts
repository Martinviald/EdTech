import { apiGet } from '@/lib/api';
import type {
  DashboardFilterOptionsResponse,
  MeasurementProcessListResponse,
  MeasurementProcessModel,
  ProcessCandidatesResponse,
  ProcessCoverageResponse,
} from '@soe/types';

export function getProcesses(query: string): Promise<MeasurementProcessListResponse> {
  return apiGet<MeasurementProcessListResponse>(`/measurement-processes${query}`);
}

export function getProcess(processId: string): Promise<MeasurementProcessModel> {
  return apiGet<MeasurementProcessModel>(`/measurement-processes/${processId}`);
}

export function getProcessCoverage(processId: string): Promise<ProcessCoverageResponse> {
  return apiGet<ProcessCoverageResponse>(`/measurement-processes/${processId}/coverage`);
}

export function getProcessCandidates(processId: string): Promise<ProcessCandidatesResponse> {
  return apiGet<ProcessCandidatesResponse>(`/measurement-processes/${processId}/candidates`);
}

export function getScopeCatalog(
  academicYearId?: string | null,
): Promise<DashboardFilterOptionsResponse> {
  const query = academicYearId ? `?academicYearId=${academicYearId}` : '';
  return apiGet<DashboardFilterOptionsResponse>(`/dashboards/filters${query}`);
}
