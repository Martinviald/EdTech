import type { AiAnalysisSnapshot } from '@soe/types';

/**
 * Puerto del ensamblador de snapshot determinista (F2 S1 — H20.1).
 *
 * BE-1 implementa `SnapshotBuilder` (reusando `AssessmentReportService` + métricas
 * nuevas); BE-2 lo inyecta por token en el runner. Así ambos compilan aislados y la
 * implementación se enchufa en integración (mismo patrón que los puertos de S0).
 */
export interface SnapshotBuildOptions {
  classGroupId?: string;
}

export interface SnapshotBuilder {
  build(
    assessmentId: string,
    orgId: string,
    opts?: SnapshotBuildOptions,
  ): Promise<AiAnalysisSnapshot>;
}

/** Token de inyección NestJS para el puerto SnapshotBuilder. */
export const SNAPSHOT_BUILDER = 'SNAPSHOT_BUILDER';
