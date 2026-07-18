import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  assessmentCourseAssignments,
  assessments,
  classGroups,
  gradingScales,
  instruments,
  orgMemberships,
  organizations,
  studentEnrollments,
  students,
  subjectClasses,
  subjects,
  teacherAssignments,
  users,
} from '@soe/db';
import {
  RESULTS_VIEWER_ROLES,
  userHasAnyRole,
  type DataGranularity,
  type OfficialReportVariant,
  type UserRole,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';

// Roles administrativos: ven toda la org. Idéntico a los demás services de
// resultados (AssessmentResults / Analytics / ItemAnalysis / AssessmentReport).
const ADMIN_LIKE_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
];

// Palabras clave de un momento "diagnóstico" (para la variante de presentación).
// Genérico por semántica del período, no hardcodea instrumento.
const DIAGNOSTIC_PERIOD_KEYS = ['diagn', 'inicial', 'initial'];

// Preguntas reflexivas genéricas por defecto (Sección 6 del informe por curso).
// Data-driven: `instruments.config.reportReflectionPrompts` las sobreescribe.
export const DEFAULT_REFLECTION_PROMPTS: readonly string[] = [
  '¿Qué habilidades o ejes muestran el mayor rezago y qué factores podrían explicarlo?',
  '¿Qué preguntas tuvieron menor logro y qué conceptos revelan como no consolidados?',
  '¿Qué estudiantes requieren mayor apoyo y qué intervención remedial se planificará?',
  '¿Qué prácticas de aula funcionaron bien y conviene mantener o replicar?',
];

export type ReportScope = { scopeAll: boolean; classGroupIds: string[] };

export type ReportAssessmentInfo = {
  id: string;
  name: string | null;
  instrumentId: string;
  instrumentName: string;
  instrumentType: string;
  instrumentYear: number | null;
  instrumentConfig: Record<string, unknown>;
  subjectId: string | null;
  subjectName: string | null;
  administeredAt: Date | null;
  gradingScaleId: string | null;
  gradingScaleConfig: unknown;
  dataGranularity: DataGranularity;
  period: string | null;
  periodLabel: string | null;
};

export type ReportOrgMeta = {
  orgId: string;
  orgName: string;
  rbd: string | null;
  commune: string | null;
  region: string | null;
};

/**
 * Servicio de soporte compartido por los tres informes oficiales: resolución de
 * org, scoping por rol (directivo = toda la org; profesor = sus cursos) y helpers
 * de metadatos (portada). Replica el patrón de scoping ya probado en los demás
 * services de resultados; las políticas RLS obligan a correr dentro de
 * `withOrgContext`, por lo que todos estos métodos reciben el `tx`.
 */
@Injectable()
export class ReportSupportService {
  constructor(@InjectDb() private readonly db: Database) {}

  requireOrgId(user: JwtPayload): string {
    if (user.orgId) return user.orgId;
    throw new ForbiddenException('Usuario sin organización asociada');
  }

  /** Cursos accesibles para el caller. Admin-like → toda la org. */
  async getAccessibleClassGroupIds(
    tx: Database,
    user: JwtPayload,
    orgId: string,
  ): Promise<ReportScope> {
    if (user.isPlatformAdmin) return { scopeAll: true, classGroupIds: [] };
    if (userHasAnyRole(user.roles, ADMIN_LIKE_ROLES)) {
      return { scopeAll: true, classGroupIds: [] };
    }
    if (!userHasAnyRole(user.roles, RESULTS_VIEWER_ROLES)) {
      return { scopeAll: false, classGroupIds: [] };
    }
    const rows = await tx
      .select({ classGroupId: subjectClasses.classGroupId })
      .from(teacherAssignments)
      .innerJoin(subjectClasses, eq(subjectClasses.id, teacherAssignments.subjectClassId))
      .innerJoin(classGroups, eq(classGroups.id, subjectClasses.classGroupId))
      .where(and(eq(teacherAssignments.userId, user.userId), eq(classGroups.orgId, orgId)));
    const ids = Array.from(new Set(rows.map((r) => r.classGroupId)));
    return { scopeAll: false, classGroupIds: ids };
  }

  /**
   * class_groups visibles combinando scope + filtro por classGroupId. `null` = sin
   * filtro extra (scopeAll sin filtro).
   *
   * Gemelo de `resolveAccessibleStudentIds` para la capa agregable — de hecho es su
   * primera mitad, sin la expansión a alumnos vía `student_enrollments`. Como el
   * read-model de cohorte está pre-agregado por `class_group` recorriendo ese mismo
   * camino, filtrar por curso selecciona la misma población que filtrar por los
   * alumnos de esos cursos, y no necesita query.
   */
  resolveAccessibleClassGroupIds(
    scope: ReportScope,
    classGroupId: string | undefined,
  ): string[] | null {
    if (scope.scopeAll && !classGroupId) return null;
    if (scope.scopeAll) return [classGroupId!];
    if (classGroupId) {
      return scope.classGroupIds.includes(classGroupId) ? [classGroupId] : [];
    }
    return scope.classGroupIds;
  }

  /** studentIds visibles combinando scope + filtro por classGroupId. `null` = sin filtro extra. */
  async resolveAccessibleStudentIds(
    tx: Database,
    orgId: string,
    scope: ReportScope,
    classGroupId: string | undefined,
  ): Promise<string[] | null> {
    if (scope.scopeAll && !classGroupId) return null;

    let allowed: string[];
    if (scope.scopeAll) {
      allowed = [classGroupId!];
    } else if (classGroupId) {
      if (!scope.classGroupIds.includes(classGroupId)) return [];
      allowed = [classGroupId];
    } else {
      allowed = scope.classGroupIds;
    }
    if (allowed.length === 0) return [];

    const rows = await tx
      .select({ studentId: studentEnrollments.studentId })
      .from(studentEnrollments)
      .innerJoin(students, eq(students.id, studentEnrollments.studentId))
      .where(
        and(
          inArray(studentEnrollments.classGroupId, allowed),
          eq(students.orgId, orgId),
          isNull(students.deletedAt),
        ),
      );
    return Array.from(new Set(rows.map((r) => r.studentId)));
  }

  async assessmentTouchesScope(
    tx: Database,
    assessmentId: string,
    classGroupIds: string[],
  ): Promise<boolean> {
    if (classGroupIds.length === 0) return false;
    const [row] = await tx
      .select({ classGroupId: assessmentCourseAssignments.classGroupId })
      .from(assessmentCourseAssignments)
      .where(
        and(
          eq(assessmentCourseAssignments.assessmentId, assessmentId),
          inArray(assessmentCourseAssignments.classGroupId, classGroupIds),
        ),
      )
      .limit(1);
    return !!row;
  }

  async classGroupInScope(
    tx: Database,
    orgId: string,
    scope: ReportScope,
    classGroupId: string,
  ): Promise<boolean> {
    if (scope.scopeAll) {
      const [cg] = await tx
        .select({ id: classGroups.id })
        .from(classGroups)
        .where(and(eq(classGroups.id, classGroupId), eq(classGroups.orgId, orgId)))
        .limit(1);
      return !!cg;
    }
    return scope.classGroupIds.includes(classGroupId);
  }

  /** Evaluación + instrumento + asignatura + escala. Lanza 404 si es de otra org. */
  async requireAssessment(
    tx: Database,
    user: JwtPayload,
    orgId: string,
    assessmentId: string,
  ): Promise<ReportAssessmentInfo> {
    const [row] = await tx
      .select({
        id: assessments.id,
        orgId: assessments.orgId,
        name: assessments.name,
        config: assessments.config,
        administeredAt: assessments.administeredAt,
        instrumentId: assessments.instrumentId,
        instrumentName: instruments.name,
        instrumentType: sql<string>`${instruments.type}::text`,
        instrumentYear: instruments.year,
        instrumentConfig: instruments.config,
        subjectId: instruments.subjectId,
        subjectName: subjects.name,
        gradingScaleId: instruments.gradingScaleId,
        gradingScaleConfig: gradingScales.config,
        dataGranularity: assessments.dataGranularity,
      })
      .from(assessments)
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .leftJoin(subjects, eq(subjects.id, instruments.subjectId))
      .leftJoin(gradingScales, eq(gradingScales.id, instruments.gradingScaleId))
      .where(and(eq(assessments.id, assessmentId), isNull(instruments.deletedAt)))
      .limit(1);

    if (!row || (!user.isPlatformAdmin && row.orgId !== orgId)) {
      throw new NotFoundException('Evaluación no encontrada');
    }

    const config = (row.config ?? {}) as Record<string, unknown>;
    const period = typeof config.period === 'string' ? config.period : null;
    const periodLabel =
      typeof config.periodLabel === 'string' ? config.periodLabel : humanizePeriod(period);

    return {
      id: row.id,
      name: row.name,
      instrumentId: row.instrumentId,
      instrumentName: row.instrumentName,
      instrumentType: row.instrumentType,
      instrumentYear: row.instrumentYear ?? null,
      instrumentConfig: (row.instrumentConfig ?? {}) as Record<string, unknown>,
      subjectId: row.subjectId ?? null,
      subjectName: row.subjectName ?? null,
      administeredAt: row.administeredAt,
      gradingScaleId: row.gradingScaleId,
      gradingScaleConfig: row.gradingScaleConfig,
      dataGranularity: row.dataGranularity as DataGranularity,
      period,
      periodLabel,
    };
  }

  async loadOrgMeta(tx: Database, orgId: string): Promise<ReportOrgMeta> {
    const [row] = await tx
      .select({
        id: organizations.id,
        name: organizations.name,
        rbd: organizations.rbd,
        commune: organizations.commune,
        region: organizations.region,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (!row) throw new NotFoundException('Organización no encontrada');
    return {
      orgId: row.id,
      orgName: row.name,
      rbd: row.rbd ?? null,
      commune: row.commune ?? null,
      region: row.region ?? null,
    };
  }

  /**
   * Nombre del director/a (mejor esfuerzo): primer membership activo con rol
   * directivo. Null si no hay. No es PII sensible de menores.
   */
  async loadDirectorName(tx: Database, orgId: string): Promise<string | null> {
    const directorRoles: UserRole[] = ['academic_director', 'school_admin', 'foundation_director'];
    const rows = await tx
      .select({
        role: sql<string>`${orgMemberships.role}::text`,
        name: users.name,
      })
      .from(orgMemberships)
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .where(
        and(
          eq(orgMemberships.orgId, orgId),
          eq(orgMemberships.isActive, true),
          inArray(orgMemberships.role, directorRoles),
          isNull(users.deletedAt),
        ),
      );
    if (rows.length === 0) return null;
    // Preferencia por jerarquía del rol.
    const priority = new Map(directorRoles.map((r, i) => [r as string, i]));
    rows.sort((a, b) => (priority.get(a.role) ?? 99) - (priority.get(b.role) ?? 99));
    return rows[0]!.name;
  }

  /** Docente de la asignatura de un curso (mejor esfuerzo). Null si no hay. */
  async loadTeacherName(
    tx: Database,
    classGroupId: string | null,
    subjectId: string | null,
  ): Promise<string | null> {
    if (!classGroupId || !subjectId) return null;
    const [row] = await tx
      .select({ name: users.name })
      .from(teacherAssignments)
      .innerJoin(subjectClasses, eq(subjectClasses.id, teacherAssignments.subjectClassId))
      .innerJoin(users, eq(users.id, teacherAssignments.userId))
      .where(
        and(
          eq(subjectClasses.classGroupId, classGroupId),
          eq(subjectClasses.subjectId, subjectId),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    return row?.name ?? null;
  }

  resolveVariant(period: string | null): OfficialReportVariant {
    if (period && DIAGNOSTIC_PERIOD_KEYS.some((k) => period.toLowerCase().includes(k))) {
      return 'requires_support';
    }
    return 'achievement_levels';
  }

  /** Advertencias de uso (data-driven). Vacío si el instrumento no las define. */
  resolveDisclaimers(instrumentConfig: Record<string, unknown>): string[] {
    const raw = instrumentConfig.reportDisclaimers;
    if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string');
    return [];
  }

  resolveReflectionPrompts(instrumentConfig: Record<string, unknown>): string[] {
    const raw = instrumentConfig.reportReflectionPrompts;
    if (Array.isArray(raw)) {
      const list = raw.filter((s): s is string => typeof s === 'string');
      if (list.length > 0) return list;
    }
    return [...DEFAULT_REFLECTION_PROMPTS];
  }
}

/** Humaniza un período crudo a una etiqueta presentable (mejor esfuerzo). */
export function humanizePeriod(period: string | null): string | null {
  if (!period) return null;
  const trimmed = period.trim();
  if (trimmed.length === 0) return null;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
