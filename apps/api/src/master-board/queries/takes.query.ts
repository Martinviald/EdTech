import { and, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import {
  academicYears,
  assessmentCourseAssignments,
  assessmentItemStats,
  assessments,
  classGroups,
  instruments,
  measurementProcesses,
} from '@soe/db';
import type { InstrumentApplicationPeriod, InstrumentType, ProcessKind } from '@soe/types';
import {
  buildAssessmentInScopeExists,
  buildAssessmentScopeCondition,
  type ClassGroupScope,
} from '../../common/helpers/class-group-scope.helper';
import type { Database } from '../../database/database.types';

export type ProcessTakeRow = {
  processId: string;
  name: string;
  kind: ProcessKind;
  period: InstrumentApplicationPeriod | null;
  academicYearId: string;
  startsOn: string | null;
  endsOn: string | null;
  createdAt: string;
};

export type ProcessLinkSummaryRow = {
  processId: string;
  linkedAssessmentCount: number;
  instrumentTypes: InstrumentType[];
  firstAdministeredAt: string | null;
  lastAdministeredAt: string | null;
};

export type ProcessResultCountRow = {
  processId: string;
  assessmentCount: number;
};

export type LegacyTakeRow = {
  academicYearId: string;
  year: number;
  instrumentType: InstrumentType;
  applicationPeriod: InstrumentApplicationPeriod | null;
  assessmentCount: number;
  firstAdministeredAt: string | null;
  lastAdministeredAt: string | null;
  firstCreatedAt: string;
};

export type ProcessSiblingCandidateRow = {
  assessmentId: string;
  processId: string | null;
  academicYearId: string;
  gradeId: string;
  instrumentId: string;
  instrumentType: InstrumentType;
  applicationPeriod: InstrumentApplicationPeriod | null;
  subjectId: string | null;
  trackId: string | null;
};

const activeProcessJoin = and(
  eq(measurementProcesses.id, assessments.processId),
  isNull(measurementProcesses.deletedAt),
);

const notCancelled = ne(assessments.status, 'cancelled');

export async function loadProcessTakeRows(
  tx: Database,
  orgId: string,
  scope: ClassGroupScope,
  academicYearId: string | undefined,
): Promise<ProcessTakeRow[]> {
  const conditions: SQL[] = [
    eq(measurementProcesses.orgId, orgId),
    isNull(measurementProcesses.deletedAt),
  ];
  if (academicYearId) conditions.push(eq(measurementProcesses.academicYearId, academicYearId));
  if (!scope.scopeAll) {
    const inScope = buildAssessmentInScopeExists(scope, {
      assessmentId: assessments.id,
      subjectId: instruments.subjectId,
    });
    conditions.push(
      sql`exists (select 1 from ${assessments} inner join ${instruments} on ${eq(
        instruments.id,
        assessments.instrumentId,
      )} where ${and(eq(assessments.processId, measurementProcesses.id), inScope)})`,
    );
  }

  return tx
    .select({
      processId: measurementProcesses.id,
      name: measurementProcesses.name,
      kind: measurementProcesses.kind,
      period: measurementProcesses.period,
      academicYearId: measurementProcesses.academicYearId,
      startsOn: measurementProcesses.startsOn,
      endsOn: measurementProcesses.endsOn,
      createdAt: sql<string>`${isoTimestamp(sql`${measurementProcesses.createdAt}`)}`,
    })
    .from(measurementProcesses)
    .where(and(...conditions));
}

export async function loadProcessLinkSummaries(
  tx: Database,
  orgId: string,
  scope: ClassGroupScope,
  processIds: string[],
): Promise<ProcessLinkSummaryRow[]> {
  if (processIds.length === 0) return [];
  const conditions: SQL[] = [
    eq(assessments.orgId, orgId),
    inArray(assessments.processId, processIds),
    isNull(instruments.deletedAt),
    notCancelled,
  ];
  const inScope = buildAssessmentInScopeExists(scope, {
    assessmentId: assessments.id,
    subjectId: instruments.subjectId,
  });
  if (inScope) conditions.push(inScope);

  return tx
    .select({
      processId: sql<string>`${assessments.processId}`,
      linkedAssessmentCount: sql<number>`count(distinct ${assessments.id})::int`,
      instrumentTypes: sql<InstrumentType[]>`array_agg(distinct ${instruments.type})`,
      firstAdministeredAt: isoTimestamp(sql`min(${assessments.administeredAt})`),
      lastAdministeredAt: isoTimestamp(sql`max(${assessments.administeredAt})`),
    })
    .from(assessments)
    .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
    .where(and(...conditions))
    .groupBy(assessments.processId);
}

export async function loadProcessResultCounts(
  tx: Database,
  orgId: string,
  scope: ClassGroupScope,
  processIds: string[],
): Promise<ProcessResultCountRow[]> {
  if (processIds.length === 0) return [];
  const conditions: SQL[] = [
    eq(assessments.orgId, orgId),
    inArray(assessments.processId, processIds),
    isNull(instruments.deletedAt),
    notCancelled,
  ];
  const inScope = buildAssessmentScopeCondition(scope, {
    classGroupId: assessmentItemStats.classGroupId,
    subjectId: instruments.subjectId,
  });
  if (inScope) conditions.push(inScope);

  return tx
    .select({
      processId: sql<string>`${assessments.processId}`,
      assessmentCount: sql<number>`count(distinct ${assessments.id})::int`,
    })
    .from(assessmentItemStats)
    .innerJoin(assessments, eq(assessments.id, assessmentItemStats.assessmentId))
    .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
    .where(and(...conditions))
    .groupBy(assessments.processId);
}

export async function loadLegacyTakeRows(
  tx: Database,
  orgId: string,
  scope: ClassGroupScope,
  academicYearId: string | undefined,
): Promise<LegacyTakeRow[]> {
  const conditions: SQL[] = [
    eq(assessments.orgId, orgId),
    isNull(instruments.deletedAt),
    notCancelled,
    isNull(measurementProcesses.id),
  ];
  const inScope = buildAssessmentScopeCondition(scope, {
    classGroupId: assessmentItemStats.classGroupId,
    subjectId: instruments.subjectId,
  });
  if (inScope) conditions.push(inScope);
  if (academicYearId) conditions.push(eq(classGroups.academicYearId, academicYearId));

  const rows = await tx
    .select({
      academicYearId: classGroups.academicYearId,
      year: academicYears.year,
      instrumentType: instruments.type,
      applicationPeriod: instruments.applicationPeriod,
      assessmentCount: sql<number>`count(distinct ${assessments.id})::int`,
      firstAdministeredAt: isoTimestamp(sql`min(${assessments.administeredAt})`),
      lastAdministeredAt: isoTimestamp(sql`max(${assessments.administeredAt})`),
      firstCreatedAt: sql<string>`${isoTimestamp(sql`min(${assessments.createdAt})`)}`,
    })
    .from(assessmentItemStats)
    .innerJoin(assessments, eq(assessments.id, assessmentItemStats.assessmentId))
    .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
    .innerJoin(classGroups, eq(classGroups.id, assessmentItemStats.classGroupId))
    .innerJoin(academicYears, eq(academicYears.id, classGroups.academicYearId))
    .leftJoin(measurementProcesses, activeProcessJoin)
    .where(and(...conditions))
    .groupBy(
      classGroups.academicYearId,
      academicYears.year,
      instruments.type,
      instruments.applicationPeriod,
    );

  return rows.map((row) => ({ ...row, instrumentType: row.instrumentType as InstrumentType }));
}

export async function loadProcessSiblingCandidates(
  tx: Database,
  orgId: string,
): Promise<ProcessSiblingCandidateRow[]> {
  const rows = await tx
    .selectDistinct({
      assessmentId: assessments.id,
      processId: measurementProcesses.id,
      academicYearId: classGroups.academicYearId,
      gradeId: classGroups.gradeId,
      instrumentId: instruments.id,
      instrumentType: instruments.type,
      applicationPeriod: instruments.applicationPeriod,
      subjectId: instruments.subjectId,
      trackId: instruments.trackId,
    })
    .from(assessments)
    .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
    .innerJoin(
      assessmentCourseAssignments,
      eq(assessmentCourseAssignments.assessmentId, assessments.id),
    )
    .innerJoin(classGroups, eq(classGroups.id, assessmentCourseAssignments.classGroupId))
    .leftJoin(measurementProcesses, activeProcessJoin)
    .where(and(eq(assessments.orgId, orgId), isNull(instruments.deletedAt), notCancelled));

  return rows.map((row) => ({ ...row, instrumentType: row.instrumentType as InstrumentType }));
}

function isoTimestamp(expression: SQL): SQL<string | null> {
  return sql<string | null>`to_char(${expression}, 'YYYY-MM-DD"T"HH24:MI:SS')`;
}
