import { ForbiddenException, Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  assessmentResults,
  assessments,
  classGroups,
  grades,
  instruments,
  performanceBands,
  studentEnrollments,
  students,
  subjects,
  withOrgContext,
} from '@soe/db';
import {
  ALERT_THRESHOLDS,
  STUDENT_SIGNALS,
  buildInstrumentFamilyKey,
  buildPeriodSeriesKey,
  deltaInPoints,
  type PerformanceBandInput,
  type PerformanceBandView,
  type StudentSignal,
  type StudentSignalsQueryDto,
  type StudentSignalsResponse,
  type StudentSignalsRow,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { resolveClassGroupScope } from '../common/helpers/class-group-scope.helper';
import { loadBandsForInstruments } from '../performance-bands/lib/load-instrument-bands';

const MAX_ROWS = 500;

type ResultRow = {
  studentId: string;
  assessmentId: string;
  instrumentId: string;
  instrumentName: string;
  instrumentType: string;
  subjectId: string | null;
  subjectName: string | null;
  gradeId: string | null;
  year: number | null;
  applicationPeriod: 'diagnostico' | 'intermedio' | 'cierre' | null;
  administeredAt: Date | null;
  achievement: number | null;
  band: PerformanceBandView | null;
  priorBand: PerformanceBandView | null;
};

function emptyCounts(): Record<StudentSignal, number> {
  return { band_drop: 0, lowest_band: 0, persistent_low: 0, achievement_drop: 0 };
}

function toBandView(
  key: string | null,
  label: string | null,
  order: number | null,
  color: string | null,
): PerformanceBandView | null {
  if (key === null || label === null || order === null) return null;
  return { key, label, order, color };
}

@Injectable()
export class StudentSignalsService {
  constructor(@InjectDb() private readonly db: Database) {}

  async getSignals(
    user: JwtPayload,
    query: StudentSignalsQueryDto,
  ): Promise<StudentSignalsResponse> {
    const orgId = user.orgId;
    if (orgId === null) {
      throw new ForbiddenException('Usuario sin organización activa');
    }

    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await resolveClassGroupScope(tx, user, orgId);
      if (!scope.scopeAll && scope.classGroupIds.length === 0) {
        return { data: [], total: 0, counts: emptyCounts() };
      }

      const roster = await this.loadRoster(tx, orgId, scope, query);
      if (roster.length === 0) {
        return { data: [], total: 0, counts: emptyCounts() };
      }

      const results = await this.loadResults(
        tx,
        orgId,
        roster.map((r) => r.studentId),
      );
      const bandsByInstrument = await loadBandsForInstruments(tx, [
        ...new Set(results.map((r) => r.instrumentId)),
      ]);

      const resultsByStudent = new Map<string, ResultRow[]>();
      for (const row of results) {
        const bucket = resultsByStudent.get(row.studentId);
        if (bucket) bucket.push(row);
        else resultsByStudent.set(row.studentId, [row]);
      }

      const counts = emptyCounts();
      const rows: StudentSignalsRow[] = roster.map((student) => {
        const own = resultsByStudent.get(student.studentId) ?? [];
        const { signals, dropPp } = this.deriveSignals(own, bandsByInstrument);
        for (const signal of signals) counts[signal] += 1;
        const latest = own[own.length - 1];
        return {
          ...student,
          assessmentsCount: own.length,
          latest: latest
            ? {
                assessmentId: latest.assessmentId,
                instrumentName: latest.instrumentName,
                subjectName: latest.subjectName,
                administeredAt: latest.administeredAt,
                achievement: latest.achievement,
                performanceBand: latest.band,
              }
            : null,
          dropPp,
          signals,
        };
      });

      const filtered = query.signal
        ? rows.filter((r) => r.signals.includes(query.signal as StudentSignal))
        : rows;

      const ordered = [...filtered].sort(
        (a, b) => b.signals.length - a.signals.length || a.fullName.localeCompare(b.fullName, 'es'),
      );

      return { data: ordered.slice(0, MAX_ROWS), total: ordered.length, counts };
    });
  }

  private async loadRoster(
    tx: Database,
    orgId: string,
    scope: { scopeAll: boolean; classGroupIds: string[] },
    query: StudentSignalsQueryDto,
  ) {
    const conditions = [eq(students.orgId, orgId), isNull(students.deletedAt)];
    if (!scope.scopeAll) {
      conditions.push(inArray(studentEnrollments.classGroupId, scope.classGroupIds));
    }
    if (query.classGroupId) {
      conditions.push(eq(studentEnrollments.classGroupId, query.classGroupId));
    }
    if (query.search) {
      const term = `%${query.search}%`;
      const match = or(
        ilike(students.firstName, term),
        ilike(students.lastName, term),
        ilike(students.rut, term),
      );
      if (match) conditions.push(match);
    }

    const rows = await tx
      .select({
        studentId: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        rut: students.rut,
        classGroupName: classGroups.name,
        gradeName: grades.name,
      })
      .from(students)
      .innerJoin(studentEnrollments, eq(studentEnrollments.studentId, students.id))
      .innerJoin(classGroups, eq(classGroups.id, studentEnrollments.classGroupId))
      .innerJoin(grades, eq(grades.id, classGroups.gradeId))
      .where(and(...conditions))
      .orderBy(asc(students.lastName), asc(students.firstName));

    const byStudent = new Map<
      string,
      {
        studentId: string;
        fullName: string;
        rut: string;
        classGroupName: string | null;
        gradeName: string | null;
      }
    >();
    for (const row of rows) {
      if (byStudent.has(row.studentId)) continue;
      byStudent.set(row.studentId, {
        studentId: row.studentId,
        fullName: `${row.firstName} ${row.lastName}`.trim(),
        rut: row.rut,
        classGroupName: row.classGroupName,
        gradeName: row.gradeName,
      });
    }
    return [...byStudent.values()];
  }

  private async loadResults(
    tx: Database,
    orgId: string,
    studentIds: string[],
  ): Promise<ResultRow[]> {
    if (studentIds.length === 0) return [];
    const priorBands = alias(performanceBands, 'prior_performance_bands');

    const rows = await tx
      .select({
        studentId: assessmentResults.studentId,
        assessmentId: assessments.id,
        instrumentId: instruments.id,
        instrumentName: instruments.name,
        instrumentType: instruments.type,
        subjectId: instruments.subjectId,
        subjectName: subjects.name,
        gradeId: instruments.gradeId,
        year: instruments.year,
        applicationPeriod: instruments.applicationPeriod,
        administeredAt: assessments.administeredAt,
        achievement: assessmentResults.percentage,
        bandKey: performanceBands.key,
        bandLabel: performanceBands.label,
        bandOrder: performanceBands.order,
        bandColor: performanceBands.color,
        priorBandKey: priorBands.key,
        priorBandLabel: priorBands.label,
        priorBandOrder: priorBands.order,
        priorBandColor: priorBands.color,
      })
      .from(assessmentResults)
      .innerJoin(assessments, eq(assessments.id, assessmentResults.assessmentId))
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .leftJoin(subjects, eq(subjects.id, instruments.subjectId))
      .leftJoin(performanceBands, eq(performanceBands.id, assessmentResults.performanceBandId))
      .leftJoin(priorBands, eq(priorBands.id, assessmentResults.priorPerformanceBandId))
      .where(
        and(
          inArray(assessmentResults.studentId, studentIds),
          eq(assessments.orgId, orgId),
          isNull(instruments.deletedAt),
        ),
      )
      .orderBy(asc(assessments.administeredAt), asc(assessments.createdAt));

    return rows.map((r) => ({
      studentId: r.studentId,
      assessmentId: r.assessmentId,
      instrumentId: r.instrumentId,
      instrumentName: r.instrumentName,
      instrumentType: r.instrumentType,
      subjectId: r.subjectId,
      subjectName: r.subjectName,
      gradeId: r.gradeId,
      year: r.year,
      applicationPeriod: r.applicationPeriod,
      administeredAt: r.administeredAt,
      achievement: r.achievement === null ? null : Number(r.achievement),
      band: toBandView(r.bandKey, r.bandLabel, r.bandOrder, r.bandColor),
      priorBand: toBandView(r.priorBandKey, r.priorBandLabel, r.priorBandOrder, r.priorBandColor),
    }));
  }

  private deriveSignals(
    results: ResultRow[],
    bandsByInstrument: Map<string, PerformanceBandInput[]>,
  ): { signals: StudentSignal[]; dropPp: number | null } {
    if (results.length === 0) return { signals: [], dropPp: null };

    const found = new Set<StudentSignal>();
    let lowestBandHits = 0;

    for (const row of results) {
      if (row.priorBand && row.band && row.band.order < row.priorBand.order) {
        found.add('band_drop');
      }
      const vocabulary = bandsByInstrument.get(row.instrumentId);
      if (row.band && vocabulary && vocabulary.length > 0) {
        const lowestOrder = Math.min(...vocabulary.map((b) => b.order));
        if (row.band.order === lowestOrder) lowestBandHits += 1;
      }
    }

    const latest = results[results.length - 1];
    if (latest?.band) {
      const vocabulary = bandsByInstrument.get(latest.instrumentId);
      if (vocabulary && vocabulary.length > 0) {
        const lowestOrder = Math.min(...vocabulary.map((b) => b.order));
        if (latest.band.order === lowestOrder) found.add('lowest_band');
      }
    }
    if (lowestBandHits >= 2) found.add('persistent_low');

    const dropPp = this.worstComparableDrop(results);
    if (dropPp !== null && Math.abs(dropPp) >= ALERT_THRESHOLDS.dropPp.medium) {
      found.add('achievement_drop');
    }

    return {
      signals: STUDENT_SIGNALS.filter((s) => found.has(s)),
      dropPp,
    };
  }

  private worstComparableDrop(results: ResultRow[]): number | null {
    const byKey = new Map<string, ResultRow[]>();
    for (const row of results) {
      if (row.achievement === null) continue;
      const ref = {
        instrumentId: row.instrumentId,
        type: row.instrumentType,
        subjectId: row.subjectId,
        gradeId: row.gradeId,
        applicationPeriod: row.applicationPeriod,
        year: row.year,
      };
      for (const key of [buildInstrumentFamilyKey(ref), buildPeriodSeriesKey(ref)]) {
        const bucket = byKey.get(key);
        if (bucket) bucket.push(row);
        else byKey.set(key, [row]);
      }
    }

    let worst: number | null = null;
    for (const group of byKey.values()) {
      if (group.length < 2) continue;
      const delta = deltaInPoints(
        group[group.length - 1]!.achievement,
        group[group.length - 2]!.achievement,
      );
      if (delta !== null && delta < 0 && (worst === null || delta < worst)) worst = delta;
    }
    return worst;
  }
}
