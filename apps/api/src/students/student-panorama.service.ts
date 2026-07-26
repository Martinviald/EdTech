import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNull, notInArray, sql } from 'drizzle-orm';
import {
  academicYears,
  assessmentResults,
  assessments,
  classGroups,
  grades,
  instruments,
  performanceBands,
  skillResults,
  studentEnrollments,
  students,
  subjects,
  taxonomyNodes,
  withOrgContext,
} from '@soe/db';
import {
  PERFORMANCE_LEVELS,
  RESULT_HIDDEN_NODE_TYPES,
  percentageToPerformanceLevel,
  type PerformanceBandView,
  type PerformanceDistributionBucket,
  type PerformanceLevel,
  type StudentPanoramaAssessment,
  type StudentPanoramaHeader,
  type StudentPanoramaResponse,
  type StudentPanoramaSkill,
  type StudentPanoramaSummary,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import {
  isStudentVisibleInScope,
  resolveClassGroupScope,
} from '../common/helpers/class-group-scope.helper';

/**
 * Construye la vista de banda a partir de las columnas del LEFT JOIN a
 * `performance_bands`. `null` si el resultado no tiene banda asignada (cae al enum
 * legacy en la UI). Lee la banda YA persistida — no reclasifica.
 */
function toBandView(r: {
  bandKey: string | null;
  bandLabel: string | null;
  bandOrder: number | null;
  bandColor: string | null;
}): PerformanceBandView | null {
  if (r.bandKey === null || r.bandLabel === null || r.bandOrder === null) return null;
  return { key: r.bandKey, label: r.bandLabel, order: r.bandOrder, color: r.bandColor };
}

@Injectable()
export class StudentPanoramaService {
  constructor(@InjectDb() private readonly db: Database) {}

  // ───────────────────────────────────────────────────────────────────────────
  // GET /students/:id/panorama — Vista 360 del estudiante (T2-20)
  // ───────────────────────────────────────────────────────────────────────────

  async getPanorama(user: JwtPayload, studentId: string): Promise<StudentPanoramaResponse> {
    const orgId = user.orgId;
    if (orgId === null) {
      throw new ForbiddenException('Usuario sin organización activa');
    }

    return withOrgContext(this.db, orgId, async (tx) => {
      // Alcance por curso (teacher scoping) — reusa el helper compartido. Un
      // profesor sólo ve alumnos de sus cursos; un directivo ve toda la org.
      const scope = await resolveClassGroupScope(tx, user, orgId);
      const visible = await isStudentVisibleInScope(tx, orgId, scope, studentId);
      if (!visible) {
        // No diferenciamos 404 vs 403 para no filtrar existencia entre cursos/orgs.
        throw new NotFoundException('Estudiante no encontrado');
      }

      const student = await this.loadStudentHeader(tx, orgId, studentId);
      if (!student) {
        throw new NotFoundException('Estudiante no encontrado');
      }

      const byAssessment = await this.loadByAssessment(tx, orgId, studentId);
      const bySkill = await this.loadBySkill(tx, orgId, studentId);
      const byLevel = this.buildLevelDistribution(byAssessment);
      const summary = this.buildSummary(byAssessment, bySkill);

      return { student, summary, byAssessment, bySkill, byLevel };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Queries
  // ───────────────────────────────────────────────────────────────────────────

  /** Identidad del alumno + curso vigente (matrícula del año más reciente). */
  private async loadStudentHeader(
    tx: Database,
    orgId: string,
    studentId: string,
  ): Promise<StudentPanoramaHeader | null> {
    const [row] = await tx
      .select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        rut: students.rut,
      })
      .from(students)
      .where(and(eq(students.id, studentId), eq(students.orgId, orgId), isNull(students.deletedAt)))
      .limit(1);
    if (!row) return null;

    // Curso vigente: la matrícula del año académico más reciente (best-effort —
    // un alumno con matrícula en varios años se muestra con la última).
    const [enrollment] = await tx
      .select({
        classGroupId: classGroups.id,
        classGroupName: classGroups.name,
        gradeName: grades.name,
      })
      .from(studentEnrollments)
      .innerJoin(classGroups, eq(classGroups.id, studentEnrollments.classGroupId))
      .innerJoin(grades, eq(grades.id, classGroups.gradeId))
      .innerJoin(academicYears, eq(academicYears.id, classGroups.academicYearId))
      .where(and(eq(studentEnrollments.studentId, studentId), eq(classGroups.orgId, orgId)))
      .orderBy(desc(academicYears.year))
      .limit(1);

    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      fullName: `${row.firstName} ${row.lastName}`.trim(),
      rut: row.rut,
      classGroup: enrollment
        ? {
            id: enrollment.classGroupId,
            name: enrollment.classGroupName,
            gradeName: enrollment.gradeName,
          }
        : null,
    };
  }

  /**
   * Resultados del alumno por evaluación (grano alumno × evaluación), ordenados
   * por fecha de aplicación. Reagrega `assessment_results` — no recalcula nada.
   */
  private async loadByAssessment(
    tx: Database,
    orgId: string,
    studentId: string,
  ): Promise<StudentPanoramaAssessment[]> {
    const rows = await tx
      .select({
        assessmentId: assessments.id,
        assessmentName: assessments.name,
        instrumentName: instruments.name,
        subjectName: subjects.name,
        administeredAt: assessments.administeredAt,
        achievement: assessmentResults.percentage,
        grade: assessmentResults.grade,
        performanceLevel: assessmentResults.performanceLevel,
        bandKey: performanceBands.key,
        bandLabel: performanceBands.label,
        bandOrder: performanceBands.order,
        bandColor: performanceBands.color,
      })
      .from(assessmentResults)
      .innerJoin(assessments, eq(assessments.id, assessmentResults.assessmentId))
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .leftJoin(subjects, eq(subjects.id, instruments.subjectId))
      .leftJoin(performanceBands, eq(performanceBands.id, assessmentResults.performanceBandId))
      .where(
        and(
          eq(assessmentResults.studentId, studentId),
          eq(assessments.orgId, orgId),
          isNull(instruments.deletedAt),
        ),
      )
      .orderBy(asc(assessments.administeredAt), asc(assessments.createdAt));

    return rows.map((r) => ({
      assessmentId: r.assessmentId,
      assessmentName: r.assessmentName,
      instrumentName: r.instrumentName,
      subjectName: r.subjectName,
      administeredAt: r.administeredAt,
      achievement: r.achievement === null ? null : Number(r.achievement),
      grade: r.grade,
      performanceLevel: r.performanceLevel,
      performanceBand: toBandView(r),
    }));
  }

  /**
   * Logro del alumno por nodo de taxonomía (habilidad/eje), promediando sus
   * `skill_results` a través de todas sus evaluaciones. Excluye los tipos de nodo
   * ocultos en resultados (descriptor) igual que dashboards/heatmap. El nivel se
   * deriva del promedio con umbrales por defecto (helper compartido, no duplica
   * lógica de bandas).
   */
  private async loadBySkill(
    tx: Database,
    orgId: string,
    studentId: string,
  ): Promise<StudentPanoramaSkill[]> {
    const rows = await tx
      .select({
        nodeId: skillResults.nodeId,
        nodeName: taxonomyNodes.name,
        nodeType: taxonomyNodes.type,
        nodeCode: taxonomyNodes.code,
        avgPct: sql<string | null>`avg(${skillResults.percentage}::numeric)`,
        assessmentsCount: sql<number>`count(distinct ${skillResults.assessmentId})::int`,
      })
      .from(skillResults)
      .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, skillResults.nodeId))
      // Join a assessments para acotar por org (defensa en profundidad — RLS ya
      // aísla, pero mantenemos el filtro explícito como el resto del módulo).
      .innerJoin(assessments, eq(assessments.id, skillResults.assessmentId))
      .where(
        and(
          eq(skillResults.studentId, studentId),
          eq(assessments.orgId, orgId),
          notInArray(taxonomyNodes.type, [...RESULT_HIDDEN_NODE_TYPES]),
        ),
      )
      .groupBy(skillResults.nodeId, taxonomyNodes.name, taxonomyNodes.type, taxonomyNodes.code)
      .orderBy(asc(sql`avg(${skillResults.percentage}::numeric)`), asc(taxonomyNodes.name));

    return rows.map((r) => {
      const averageAchievement = r.avgPct === null ? null : Number(r.avgPct);
      return {
        nodeId: r.nodeId,
        nodeName: r.nodeName,
        nodeType: r.nodeType,
        nodeCode: r.nodeCode,
        averageAchievement,
        assessmentsCount: Number(r.assessmentsCount ?? 0),
        performanceLevel:
          averageAchievement === null
            ? null
            : percentageToPerformanceLevel(averageAchievement / 100),
      };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Agregación en memoria (sobre lo ya traído)
  // ───────────────────────────────────────────────────────────────────────────

  /** Distribución del alumno por nivel de desempeño, a partir de sus evaluaciones. */
  private buildLevelDistribution(
    byAssessment: StudentPanoramaAssessment[],
  ): PerformanceDistributionBucket[] {
    const counts = new Map<PerformanceLevel, number>();
    for (const a of byAssessment) {
      if (!a.performanceLevel) continue;
      counts.set(a.performanceLevel, (counts.get(a.performanceLevel) ?? 0) + 1);
    }
    const total = Array.from(counts.values()).reduce((acc, n) => acc + n, 0);
    return PERFORMANCE_LEVELS.map((level) => {
      const count = counts.get(level) ?? 0;
      return { level, count, percentage: total > 0 ? (count / total) * 100 : 0 };
    });
  }

  private buildSummary(
    byAssessment: StudentPanoramaAssessment[],
    bySkill: StudentPanoramaSkill[],
  ): StudentPanoramaSummary {
    const withPct = byAssessment.filter(
      (a): a is StudentPanoramaAssessment & { achievement: number } => a.achievement !== null,
    );
    const averageAchievement =
      withPct.length > 0
        ? withPct.reduce((acc, a) => acc + a.achievement, 0) / withPct.length
        : null;
    return {
      assessmentsCount: byAssessment.length,
      averageAchievement,
      skillsAssessed: bySkill.length,
    };
  }
}
