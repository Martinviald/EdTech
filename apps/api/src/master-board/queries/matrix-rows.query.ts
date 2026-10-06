import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  assessmentItemStats,
  assessments,
  classGroups,
  grades,
  instrumentSections,
  instruments,
  items,
  subjects,
  testTracks,
} from '@soe/db';
import type { Database } from '../../database/database.types';

export type MatrixRowsFilter = {
  assessmentIds: string[];
  scopedClassGroupIds: string[] | null;
  gradeIds?: string[];
  subjectIds?: string[];
};

export type MatrixRow = {
  gradeId: string;
  gradeName: string;
  gradeOrder: number;
  classGroupId: string;
  classGroupName: string;
  subjectId: string;
  subjectName: string;
  subjectShortName: string;
  trackId: string | null;
  trackName: string | null;
  trackShortName: string | null;
  trackOrder: number | null;
  fromElectiveInstrument: boolean;
  scoreSum: string | null;
  maxSum: string | null;
  studentsAssessed: number;
  assessmentIds: string[];
  instrumentIds: string[];
};

export async function loadMatrixRows(tx: Database, filter: MatrixRowsFilter): Promise<MatrixRow[]> {
  if (filter.assessmentIds.length === 0) return [];

  const conditions: SQL[] = [
    inArray(assessments.id, filter.assessmentIds),
    sql`${instruments.subjectId} is not null`,
  ];
  if (filter.scopedClassGroupIds !== null) {
    conditions.push(inArray(assessmentItemStats.classGroupId, filter.scopedClassGroupIds));
  }
  if (filter.gradeIds?.length) conditions.push(inArray(classGroups.gradeId, filter.gradeIds));
  if (filter.subjectIds?.length) {
    conditions.push(inArray(instruments.subjectId, filter.subjectIds));
  }

  const electiveInstruments = tx
    .selectDistinct({ instrumentId: instrumentSections.instrumentId })
    .from(instrumentSections)
    .where(eq(instrumentSections.role, 'elective'))
    .as('elective_instruments');

  const columnTrackId = sql<
    string | null
  >`coalesce(${instrumentSections.trackId}, ${instruments.trackId})`;

  return tx
    .select({
      gradeId: classGroups.gradeId,
      gradeName: grades.name,
      gradeOrder: grades.order,
      classGroupId: assessmentItemStats.classGroupId,
      classGroupName: classGroups.name,
      subjectId: subjects.id,
      subjectName: subjects.name,
      subjectShortName: subjects.shortName,
      trackId: columnTrackId,
      trackName: testTracks.name,
      trackShortName: testTracks.shortName,
      trackOrder: testTracks.order,
      fromElectiveInstrument: sql<boolean>`bool_or(${electiveInstruments.instrumentId} is not null)`,
      scoreSum: sql<string | null>`sum(${assessmentItemStats.scoreSum}::numeric)`,
      maxSum: sql<string | null>`sum(${assessmentItemStats.maxSum}::numeric)`,
      studentsAssessed: sql<number>`max(${assessmentItemStats.studentCount})::int`,
      assessmentIds: sql<string[]>`array_agg(distinct ${assessments.id})`,
      instrumentIds: sql<string[]>`array_agg(distinct ${instruments.id})`,
    })
    .from(assessmentItemStats)
    .innerJoin(assessments, eq(assessments.id, assessmentItemStats.assessmentId))
    .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
    .innerJoin(items, eq(items.id, assessmentItemStats.itemId))
    .leftJoin(instrumentSections, eq(instrumentSections.id, items.sectionId))
    .leftJoin(testTracks, sql`${testTracks.id} = ${columnTrackId}`)
    .leftJoin(electiveInstruments, eq(electiveInstruments.instrumentId, instruments.id))
    .innerJoin(subjects, eq(subjects.id, instruments.subjectId))
    .innerJoin(classGroups, eq(classGroups.id, assessmentItemStats.classGroupId))
    .innerJoin(grades, eq(grades.id, classGroups.gradeId))
    .where(and(...conditions))
    .groupBy(
      classGroups.gradeId,
      grades.name,
      grades.order,
      assessmentItemStats.classGroupId,
      classGroups.name,
      subjects.id,
      subjects.name,
      subjects.shortName,
      columnTrackId,
      testTracks.id,
      testTracks.name,
      testTracks.shortName,
      testTracks.order,
    );
}
