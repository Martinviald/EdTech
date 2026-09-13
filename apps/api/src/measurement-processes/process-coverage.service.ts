import { Injectable } from '@nestjs/common';
import { and, countDistinct, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  assessmentCourseAssignments,
  assessmentResults,
  assessments,
  classGroups,
  grades,
  instruments,
  studentEnrollments,
  students,
  subjects,
} from '@soe/db';
import type { Database } from '../database/database.types';
import {
  assembleCoverage,
  type CoverageAssembly,
  type CoverageAssessmentCell,
  type CoverageCatalog,
  type ProcessRow,
} from './measurement-processes.helpers';

export type ProcessAssessmentStats = {
  assessmentCount: number;
  studentsAssessed: number;
};

export const EMPTY_COVERAGE: CoverageAssembly = {
  totals: { expected: 0, missing: 0, scheduled: 0, partial: 0, complete: 0 },
  cells: [],
  unexpectedCells: [],
};

@Injectable()
export class ProcessCoverageService {
  async loadAssessmentStats(
    tx: Database,
    processIds: readonly string[],
  ): Promise<Map<string, ProcessAssessmentStats>> {
    const stats = new Map<string, ProcessAssessmentStats>();
    if (processIds.length === 0) return stats;

    const counts = await tx
      .select({
        processId: assessments.processId,
        assessmentCount: sql<number>`count(*)::int`,
      })
      .from(assessments)
      .where(inArray(assessments.processId, [...processIds]))
      .groupBy(assessments.processId);

    for (const row of counts) {
      if (!row.processId) continue;
      stats.set(row.processId, { assessmentCount: row.assessmentCount, studentsAssessed: 0 });
    }

    const studentCounts = await tx
      .select({
        processId: assessments.processId,
        studentsAssessed: countDistinct(assessmentResults.studentId),
      })
      .from(assessmentResults)
      .innerJoin(assessments, eq(assessments.id, assessmentResults.assessmentId))
      .where(inArray(assessments.processId, [...processIds]))
      .groupBy(assessments.processId);

    for (const row of studentCounts) {
      if (!row.processId) continue;
      const entry = stats.get(row.processId);
      if (entry) entry.studentsAssessed = Number(row.studentsAssessed);
    }

    return stats;
  }

  async load(
    tx: Database,
    orgId: string,
    processRows: readonly ProcessRow[],
  ): Promise<Map<string, CoverageAssembly>> {
    const result = new Map<string, CoverageAssembly>();
    if (processRows.length === 0) return result;

    const processIds = processRows.map((p) => p.id);

    const cellRows = await tx
      .select({
        processId: assessments.processId,
        assessmentId: assessments.id,
        assessmentName: assessments.name,
        classGroupId: classGroups.id,
        classGroupName: classGroups.name,
        gradeShortName: grades.shortName,
        gradeOrder: grades.order,
        subjectId: instruments.subjectId,
        subjectName: subjects.name,
        subjectShortName: subjects.shortName,
      })
      .from(assessments)
      .innerJoin(
        assessmentCourseAssignments,
        eq(assessmentCourseAssignments.assessmentId, assessments.id),
      )
      .innerJoin(classGroups, eq(classGroups.id, assessmentCourseAssignments.classGroupId))
      .innerJoin(grades, eq(grades.id, classGroups.gradeId))
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .leftJoin(subjects, eq(subjects.id, instruments.subjectId))
      .where(and(eq(assessments.orgId, orgId), inArray(assessments.processId, processIds)));

    const assessmentIds = Array.from(new Set(cellRows.map((r) => r.assessmentId)));
    const resultCounts = assessmentIds.length
      ? await tx
          .select({
            assessmentId: assessmentResults.assessmentId,
            classGroupId: studentEnrollments.classGroupId,
            studentsWithResults: countDistinct(assessmentResults.studentId),
          })
          .from(assessmentResults)
          .innerJoin(
            studentEnrollments,
            eq(studentEnrollments.studentId, assessmentResults.studentId),
          )
          .innerJoin(students, eq(students.id, assessmentResults.studentId))
          .where(
            and(inArray(assessmentResults.assessmentId, assessmentIds), isNull(students.deletedAt)),
          )
          .groupBy(assessmentResults.assessmentId, studentEnrollments.classGroupId)
      : [];

    const resultsByCell = new Map<string, number>();
    for (const row of resultCounts) {
      resultsByCell.set(`${row.assessmentId}:${row.classGroupId}`, Number(row.studentsWithResults));
    }

    const scopeClassGroupIds = new Set<string>();
    const scopeSubjectIds = new Set<string>();
    for (const process of processRows) {
      for (const id of process.expectedScope?.classGroupIds ?? []) scopeClassGroupIds.add(id);
      for (const id of process.expectedScope?.subjectIds ?? []) scopeSubjectIds.add(id);
    }
    for (const row of cellRows) scopeClassGroupIds.add(row.classGroupId);

    const catalog = await this.loadCatalog(
      tx,
      orgId,
      Array.from(scopeClassGroupIds),
      Array.from(scopeSubjectIds),
    );

    const cellsByProcess = new Map<string, CoverageAssessmentCell[]>();
    for (const row of cellRows) {
      if (!row.processId) continue;
      let bucket = cellsByProcess.get(row.processId);
      if (!bucket) {
        bucket = [];
        cellsByProcess.set(row.processId, bucket);
      }
      bucket.push({
        assessmentId: row.assessmentId,
        assessmentName: row.assessmentName,
        classGroupId: row.classGroupId,
        classGroupName: row.classGroupName,
        gradeShortName: row.gradeShortName,
        gradeOrder: row.gradeOrder,
        subjectId: row.subjectId,
        subjectName: row.subjectName,
        subjectShortName: row.subjectShortName,
        studentsWithResults: resultsByCell.get(`${row.assessmentId}:${row.classGroupId}`) ?? 0,
      });
    }

    for (const process of processRows) {
      result.set(
        process.id,
        assembleCoverage(process.expectedScope, cellsByProcess.get(process.id) ?? [], catalog),
      );
    }

    return result;
  }

  private async loadCatalog(
    tx: Database,
    orgId: string,
    classGroupIds: readonly string[],
    subjectIds: readonly string[],
  ): Promise<CoverageCatalog> {
    const catalog: CoverageCatalog = {
      classGroups: new Map(),
      subjects: new Map(),
      studentsByClassGroup: new Map(),
    };

    if (classGroupIds.length > 0) {
      const rows = await tx
        .select({
          id: classGroups.id,
          name: classGroups.name,
          gradeShortName: grades.shortName,
          gradeOrder: grades.order,
        })
        .from(classGroups)
        .innerJoin(grades, eq(grades.id, classGroups.gradeId))
        .where(and(eq(classGroups.orgId, orgId), inArray(classGroups.id, [...classGroupIds])));
      for (const row of rows) {
        catalog.classGroups.set(row.id, {
          name: row.name,
          gradeShortName: row.gradeShortName,
          gradeOrder: row.gradeOrder,
        });
      }

      const enrollmentCounts = await tx
        .select({
          classGroupId: studentEnrollments.classGroupId,
          total: countDistinct(studentEnrollments.studentId),
        })
        .from(studentEnrollments)
        .innerJoin(students, eq(students.id, studentEnrollments.studentId))
        .where(
          and(
            inArray(studentEnrollments.classGroupId, [...classGroupIds]),
            eq(studentEnrollments.status, 'active'),
            isNull(students.deletedAt),
          ),
        )
        .groupBy(studentEnrollments.classGroupId);
      for (const row of enrollmentCounts) {
        catalog.studentsByClassGroup.set(row.classGroupId, Number(row.total));
      }
    }

    if (subjectIds.length > 0) {
      const rows = await tx
        .select({ id: subjects.id, name: subjects.name, shortName: subjects.shortName })
        .from(subjects)
        .where(inArray(subjects.id, [...subjectIds]));
      for (const row of rows) {
        catalog.subjects.set(row.id, { name: row.name, shortName: row.shortName });
      }
    }

    return catalog;
  }
}
