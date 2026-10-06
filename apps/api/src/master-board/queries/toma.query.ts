import { and, eq, isNull, ne, type SQL } from 'drizzle-orm';
import {
  assessmentItemStats,
  assessments,
  classGroups,
  instruments,
  measurementProcesses,
} from '@soe/db';
import type { InstrumentApplicationPeriod } from '@soe/types';
import type { Database } from '../../database/database.types';

export type TomaAssessmentRow = {
  assessmentId: string;
  activeProcessId: string | null;
  instrumentId: string;
  instrumentType: string;
  subjectId: string | null;
  gradeId: string | null;
  applicationPeriod: InstrumentApplicationPeriod | null;
  year: number | null;
  trackId: string | null;
};

export async function loadTomaAssessmentRows(
  tx: Database,
  orgId: string,
  conditions: SQL[],
): Promise<TomaAssessmentRow[]> {
  return tx
    .selectDistinct({
      assessmentId: assessments.id,
      activeProcessId: measurementProcesses.id,
      instrumentId: instruments.id,
      instrumentType: instruments.type,
      subjectId: instruments.subjectId,
      gradeId: instruments.gradeId,
      applicationPeriod: instruments.applicationPeriod,
      year: instruments.year,
      trackId: instruments.trackId,
    })
    .from(assessmentItemStats)
    .innerJoin(assessments, eq(assessments.id, assessmentItemStats.assessmentId))
    .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
    .innerJoin(classGroups, eq(classGroups.id, assessmentItemStats.classGroupId))
    .leftJoin(
      measurementProcesses,
      and(
        eq(measurementProcesses.id, assessments.processId),
        isNull(measurementProcesses.deletedAt),
      ),
    )
    .where(
      and(
        eq(assessments.orgId, orgId),
        isNull(instruments.deletedAt),
        ne(assessments.status, 'cancelled'),
        ...conditions,
      ),
    );
}
