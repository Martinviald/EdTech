import { apiGet } from '@/lib/api';
import type {
  MeasurementProcessListResponse,
  MeasurementProcessModel,
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
