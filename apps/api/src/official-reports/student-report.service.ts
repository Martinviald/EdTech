import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  assessmentCourseAssignments,
  assessmentResults,
  classGroups,
  grades,
  responses,
  skillResults,
  studentEnrollments,
  students,
  taxonomyNodes,
  withOrgContext,
} from '@soe/db';
import {
  REQUIRES_SUPPORT_LEVEL,
  type OfficialStudentItemRow,
  type OfficialStudentOverallResult,
  type OfficialStudentReportQueryDto,
  type OfficialStudentReportResponse,
  type OfficialStudentSkillRow,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { ReportSupportService } from './report-support.service';
import { loadItemColumns } from './lib/item-report-data';

@Injectable()
export class StudentReportService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly support: ReportSupportService,
  ) {}

  async getStudentReport(
    user: JwtPayload,
    query: OfficialStudentReportQueryDto,
  ): Promise<OfficialStudentReportResponse> {
    const orgId = this.support.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      const assessment = await this.support.requireAssessment(
        tx,
        user,
        orgId,
        query.assessmentId,
      );
      const scope = await this.support.getAccessibleClassGroupIds(tx, user, orgId);

      if (!scope.scopeAll) {
        const hasScope = await this.support.assessmentTouchesScope(
          tx,
          query.assessmentId,
          scope.classGroupIds,
        );
        if (!hasScope) {
          throw new ForbiddenException('No tiene acceso a los resultados de esta evaluación');
        }
      }

      // El alumno debe estar dentro del scope del caller (profesor = sus cursos).
      const allowedStudentIds = await this.support.resolveAccessibleStudentIds(
        tx,
        orgId,
        scope,
        undefined,
      );
      if (allowedStudentIds !== null && !allowedStudentIds.includes(query.studentId)) {
        throw new ForbiddenException('No tiene acceso a este estudiante');
      }

      const [student, classGroup, orgMeta, directorName] = await Promise.all([
        this.loadStudent(tx, orgId, query.studentId),
        this.loadStudentClassGroup(tx, query.assessmentId, query.studentId),
        this.support.loadOrgMeta(tx, orgId),
        this.support.loadDirectorName(tx, orgId),
      ]);

      const result = await this.loadOverallResult(
        tx,
        query.assessmentId,
        query.studentId,
        orgId,
        scope.scopeAll ? null : scope.classGroupIds,
      );
      const skills = await this.loadSkills(tx, query.assessmentId, query.studentId);
      const items = await this.loadItems(
        tx,
        query.assessmentId,
        query.studentId,
        assessment.instrumentId,
      );

      const meta: OfficialStudentReportResponse['meta'] = {
        orgId,
        orgName: orgMeta.orgName,
        rbd: orgMeta.rbd,
        commune: orgMeta.commune,
        region: orgMeta.region,
        directorName,
        instrumentId: assessment.instrumentId,
        instrumentName: assessment.instrumentName,
        instrumentType: assessment.instrumentType,
        subjectId: assessment.subjectId,
        subjectName: assessment.subjectName,
        period: assessment.period,
        periodLabel: assessment.periodLabel,
        year: assessment.instrumentYear,
        generatedAt: new Date().toISOString(),
        disclaimers: this.support.resolveDisclaimers(assessment.instrumentConfig),
        variant: this.support.resolveVariant(assessment.period),
        student: {
          id: student.id,
          rut: student.rut,
          fullName: `${student.firstName} ${student.lastName}`.trim(),
        },
        classGroup,
        administeredAt: assessment.administeredAt,
      };

      return { meta, result, skills, items };
    });
  }

  private async loadStudent(
    tx: Database,
    orgId: string,
    studentId: string,
  ): Promise<{ id: string; rut: string; firstName: string; lastName: string }> {
    const [row] = await tx
      .select({
        id: students.id,
        rut: students.rut,
        firstName: students.firstName,
        lastName: students.lastName,
      })
      .from(students)
      .where(
        and(
          eq(students.id, studentId),
          eq(students.orgId, orgId),
          isNull(students.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Estudiante no encontrado');
    return row;
  }

  private async loadStudentClassGroup(
    tx: Database,
    assessmentId: string,
    studentId: string,
  ): Promise<{ id: string; name: string; gradeName: string | null } | null> {
    const [row] = await tx
      .select({
        id: classGroups.id,
        name: classGroups.name,
        gradeName: grades.name,
      })
      .from(studentEnrollments)
      .innerJoin(classGroups, eq(classGroups.id, studentEnrollments.classGroupId))
      .innerJoin(
        assessmentCourseAssignments,
        and(
          eq(assessmentCourseAssignments.classGroupId, classGroups.id),
          eq(assessmentCourseAssignments.assessmentId, assessmentId),
        ),
      )
      .leftJoin(grades, eq(grades.id, classGroups.gradeId))
      .where(eq(studentEnrollments.studentId, studentId))
      .orderBy(asc(classGroups.name))
      .limit(1);
    if (!row) return null;
    return { id: row.id, name: row.name, gradeName: row.gradeName ?? null };
  }

  private async loadOverallResult(
    tx: Database,
    assessmentId: string,
    studentId: string,
    orgId: string,
    scopeClassGroupIds: string[] | null,
  ): Promise<OfficialStudentOverallResult> {
    const [row] = await tx
      .select({
        percentage: assessmentResults.percentage,
        grade: assessmentResults.grade,
        totalScore: assessmentResults.totalScore,
        maxScore: assessmentResults.maxScore,
        performanceLevel: assessmentResults.performanceLevel,
      })
      .from(assessmentResults)
      .where(
        and(
          eq(assessmentResults.assessmentId, assessmentId),
          eq(assessmentResults.studentId, studentId),
        ),
      )
      .limit(1);

    if (!row) {
      throw new NotFoundException('El estudiante no tiene resultados en esta evaluación');
    }

    // Aciertos / total de ítems respondidos.
    const [counts] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        correct: sql<number>`sum(case when ${responses.isCorrect} = true then 1 else 0 end)::int`,
      })
      .from(responses)
      .where(
        and(
          eq(responses.assessmentId, assessmentId),
          eq(responses.studentId, studentId),
        ),
      );

    const classAverageAchievement = await this.loadClassAverage(
      tx,
      assessmentId,
      orgId,
      scopeClassGroupIds,
    );

    const percentage = row.percentage === null ? null : Number(row.percentage);
    return {
      achievement: percentage,
      grade: row.grade === null ? null : Number(row.grade),
      totalScore: row.totalScore === null ? null : Number(row.totalScore),
      maxScore: row.maxScore === null ? null : Number(row.maxScore),
      correctCount: Number(counts?.correct ?? 0),
      totalItems: Number(counts?.total ?? 0),
      performanceLevel: row.performanceLevel,
      requiresSupport: row.performanceLevel === REQUIRES_SUPPORT_LEVEL,
      classAverageAchievement,
    };
  }

  private async loadClassAverage(
    tx: Database,
    assessmentId: string,
    orgId: string,
    scopeClassGroupIds: string[] | null,
  ): Promise<number | null> {
    // Promedio del curso: assessment_results de la evaluación, acotado al scope.
    const conditions = [
      eq(assessmentResults.assessmentId, assessmentId),
      eq(students.orgId, orgId),
      isNull(students.deletedAt),
    ];

    if (scopeClassGroupIds !== null) {
      if (scopeClassGroupIds.length === 0) return null;
      const [row] = await tx
        .select({
          avgPct: sql<string | null>`avg(${assessmentResults.percentage}::numeric)`,
        })
        .from(assessmentResults)
        .innerJoin(students, eq(students.id, assessmentResults.studentId))
        .innerJoin(
          studentEnrollments,
          eq(studentEnrollments.studentId, assessmentResults.studentId),
        )
        .where(and(...conditions, inArray(studentEnrollments.classGroupId, scopeClassGroupIds)));
      return row?.avgPct == null ? null : Number(row.avgPct);
    }

    const [row] = await tx
      .select({ avgPct: sql<string | null>`avg(${assessmentResults.percentage}::numeric)` })
      .from(assessmentResults)
      .innerJoin(students, eq(students.id, assessmentResults.studentId))
      .where(and(...conditions));
    return row?.avgPct == null ? null : Number(row.avgPct);
  }

  private async loadSkills(
    tx: Database,
    assessmentId: string,
    studentId: string,
  ): Promise<OfficialStudentSkillRow[]> {
    const rows = await tx
      .select({
        nodeId: taxonomyNodes.id,
        nodeName: taxonomyNodes.name,
        nodeType: sql<string>`${taxonomyNodes.type}::text`,
        nodeCode: taxonomyNodes.code,
        correctCount: skillResults.correctCount,
        totalCount: skillResults.totalCount,
        percentage: skillResults.percentage,
        performanceLevel: skillResults.performanceLevel,
      })
      .from(skillResults)
      .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, skillResults.nodeId))
      .where(
        and(
          eq(skillResults.assessmentId, assessmentId),
          eq(skillResults.studentId, studentId),
        ),
      );

    return rows
      .map((r) => ({
        nodeId: r.nodeId,
        nodeName: r.nodeName,
        nodeType: r.nodeType,
        nodeCode: r.nodeCode ?? null,
        correctCount: r.correctCount,
        totalCount: r.totalCount,
        percentage: r.percentage === null ? null : Number(r.percentage),
        performanceLevel: r.performanceLevel,
      }))
      .sort((a, b) => (a.percentage ?? 101) - (b.percentage ?? 101));
  }

  private async loadItems(
    tx: Database,
    assessmentId: string,
    studentId: string,
    instrumentId: string,
  ): Promise<OfficialStudentItemRow[]> {
    const columns = await loadItemColumns(tx, instrumentId);

    const rows = await tx
      .select({
        itemId: responses.itemId,
        value: responses.value,
        isCorrect: responses.isCorrect,
        finalScore: responses.finalScore,
        rawScore: responses.rawScore,
        maxScore: responses.maxScore,
      })
      .from(responses)
      .where(
        and(
          eq(responses.assessmentId, assessmentId),
          eq(responses.studentId, studentId),
        ),
      );

    const byItem = new Map(rows.map((r) => [r.itemId, r]));

    const items: OfficialStudentItemRow[] = columns.map((col) => {
      const r = byItem.get(col.itemId);
      const score =
        r?.finalScore != null
          ? Number(r.finalScore)
          : r?.rawScore != null
            ? Number(r.rawScore)
            : null;
      return {
        itemId: col.itemId,
        position: col.position,
        itemType: col.itemType,
        oaCode: col.oaCode,
        axis: col.axis,
        skill: col.skill,
        textType: col.textType,
        selectedKey: r ? extractRawAnswer(r.value) : null,
        correctKey: col.correctKey,
        isCorrect: r?.isCorrect ?? null,
        score,
        maxScore: r?.maxScore != null ? Number(r.maxScore) : 0,
      };
    });
    return items.sort((a, b) => a.position - b.position);
  }
}

function extractRawAnswer(value: Record<string, unknown>): string | null {
  if (!value || typeof value !== 'object') return null;
  const raw =
    (value as Record<string, unknown>).raw ??
    (value as Record<string, unknown>).key ??
    (value as Record<string, unknown>).answer;
  if (raw == null) return null;
  const str = typeof raw === 'string' ? raw : String(raw);
  return str.length > 0 ? str : null;
}
