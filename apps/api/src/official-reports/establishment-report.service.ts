import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  academicYears,
  assessmentCourseAssignments,
  assessmentResults,
  assessments,
  classGroups,
  grades,
  instruments,
  studentEnrollments,
  students,
  subjects,
  withOrgContext,
} from '@soe/db';
import {
  OFFICIAL_REPORT_LEVEL_ORDER,
  type EstablishmentCountRow,
  type EstablishmentGradeColumn,
  type EstablishmentLevelCell,
  type EstablishmentSexComparisonRow,
  type EstablishmentSubjectSection,
  type OfficialEstablishmentReportQueryDto,
  type OfficialEstablishmentReportResponse,
  type PerformanceLevel,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { ReportSupportService, humanizePeriod } from './report-support.service';
import { compareSexes } from './lib/sex-comparison';

const SCOPE_NOTE_SOCIOEMOTIONAL =
  'El Área Socioemocional del informe oficial no se reproduce: la plataforma no ingesta el cuestionario socioemocional. Sólo se genera el Área Académica (Tablas 1.1–1.9).';

// Fila cruda por estudiante × asignatura × grado.
type RawRow = {
  studentId: string;
  gender: string | null;
  percentage: number | null;
  performanceLevel: PerformanceLevel | null;
  subjectId: string;
  subjectName: string;
  gradeId: string;
  gradeName: string;
  gradeOrder: number;
  instrumentId: string;
};

// Acumulador por asignatura.
type SubjectAcc = {
  subjectId: string;
  subjectName: string;
  grades: Map<string, EstablishmentGradeColumn>;
  // (gradeId → level → count) y total por grado.
  levelCounts: Map<string, Map<PerformanceLevel, number>>;
  gradeTotals: Map<string, number>;
  // (gradeId → { female %[], male %[], counts }).
  sex: Map<string, { female: number[]; male: number[]; f: number; m: number; other: number }>;
};

@Injectable()
export class EstablishmentReportService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly support: ReportSupportService,
  ) {}

  async getEstablishmentReport(
    user: JwtPayload,
    query: OfficialEstablishmentReportQueryDto,
  ): Promise<OfficialEstablishmentReportResponse> {
    const orgId = this.support.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      const academicYear = await this.resolveAcademicYear(tx, orgId, query.academicYearId);

      const rawRows = await this.loadRawRows(
        tx,
        orgId,
        academicYear.id,
        query.period ?? null,
      );

      const [orgMeta, directorName] = await Promise.all([
        this.support.loadOrgMeta(tx, orgId),
        this.support.loadDirectorName(tx, orgId),
      ]);

      const { disclaimers, levelDefinitions } = await this.loadInstrumentMeta(
        tx,
        Array.from(new Set(rawRows.map((r) => r.instrumentId))),
      );

      const subjects = this.aggregate(rawRows);
      const sexDataAvailable = rawRows.some((r) => r.gender === 'F' || r.gender === 'M');

      return {
        meta: {
          orgId: orgMeta.orgId,
          orgName: orgMeta.orgName,
          rbd: orgMeta.rbd,
          commune: orgMeta.commune,
          region: orgMeta.region,
          directorName,
          academicYearId: academicYear.id,
          academicYear: academicYear.year,
          period: query.period ?? null,
          periodLabel: humanizePeriod(query.period ?? null),
          generatedAt: new Date().toISOString(),
          disclaimers,
          variant: this.support.resolveVariant(query.period ?? null),
        },
        levelDefinitions,
        subjects,
        sexDataAvailable,
        scopeNotes: [SCOPE_NOTE_SOCIOEMOTIONAL],
      };
    });
  }

  private async resolveAcademicYear(
    tx: Database,
    orgId: string,
    academicYearId: string | undefined,
  ): Promise<{ id: string; year: number | null }> {
    if (academicYearId) {
      const [row] = await tx
        .select({ id: academicYears.id, year: academicYears.year })
        .from(academicYears)
        .where(and(eq(academicYears.id, academicYearId), eq(academicYears.orgId, orgId)))
        .limit(1);
      if (!row) throw new NotFoundException('Año académico no encontrado');
      return { id: row.id, year: row.year };
    }
    const [current] = await tx
      .select({ id: academicYears.id, year: academicYears.year })
      .from(academicYears)
      .where(and(eq(academicYears.orgId, orgId), eq(academicYears.isCurrent, true)))
      .limit(1);
    if (!current) {
      throw new NotFoundException(
        'No hay un año académico actual configurado; especifique academicYearId',
      );
    }
    return { id: current.id, year: current.year };
  }

  private async loadRawRows(
    tx: Database,
    orgId: string,
    academicYearId: string,
    period: string | null,
  ): Promise<RawRow[]> {
    const conditions = [
      eq(assessments.orgId, orgId),
      eq(classGroups.academicYearId, academicYearId),
      eq(students.orgId, orgId),
      isNull(students.deletedAt),
      isNull(instruments.deletedAt),
    ];
    if (period) {
      conditions.push(sql`${assessments.config}->>'period' = ${period}`);
    }

    const rows = await tx
      .select({
        studentId: assessmentResults.studentId,
        gender: sql<string | null>`${students.gender}::text`,
        percentage: assessmentResults.percentage,
        performanceLevel: assessmentResults.performanceLevel,
        subjectId: instruments.subjectId,
        subjectName: subjects.name,
        gradeId: classGroups.gradeId,
        gradeName: grades.name,
        gradeOrder: grades.order,
        instrumentId: assessments.instrumentId,
      })
      .from(assessmentResults)
      .innerJoin(assessments, eq(assessments.id, assessmentResults.assessmentId))
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .leftJoin(subjects, eq(subjects.id, instruments.subjectId))
      .innerJoin(students, eq(students.id, assessmentResults.studentId))
      .innerJoin(
        assessmentCourseAssignments,
        eq(assessmentCourseAssignments.assessmentId, assessments.id),
      )
      .innerJoin(
        classGroups,
        eq(classGroups.id, assessmentCourseAssignments.classGroupId),
      )
      .innerJoin(
        studentEnrollments,
        and(
          eq(studentEnrollments.studentId, assessmentResults.studentId),
          eq(studentEnrollments.classGroupId, classGroups.id),
        ),
      )
      .innerJoin(grades, eq(grades.id, classGroups.gradeId))
      .where(and(...conditions));

    // Sólo filas con asignatura conocida (el informe agrega por asignatura).
    const seen = new Set<string>();
    const out: RawRow[] = [];
    for (const r of rows) {
      if (!r.subjectId || !r.subjectName) continue;
      const key = `${r.studentId}|${r.subjectId}|${r.gradeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        studentId: r.studentId,
        gender: r.gender,
        percentage: r.percentage === null ? null : Number(r.percentage),
        performanceLevel: r.performanceLevel,
        subjectId: r.subjectId,
        subjectName: r.subjectName,
        gradeId: r.gradeId,
        gradeName: r.gradeName,
        gradeOrder: r.gradeOrder,
        instrumentId: r.instrumentId,
      });
    }
    return out;
  }

  private aggregate(rawRows: RawRow[]): EstablishmentSubjectSection[] {
    const bySubject = new Map<string, SubjectAcc>();

    for (const r of rawRows) {
      let acc = bySubject.get(r.subjectId);
      if (!acc) {
        acc = {
          subjectId: r.subjectId,
          subjectName: r.subjectName,
          grades: new Map(),
          levelCounts: new Map(),
          gradeTotals: new Map(),
          sex: new Map(),
        };
        bySubject.set(r.subjectId, acc);
      }

      if (!acc.grades.has(r.gradeId)) {
        acc.grades.set(r.gradeId, {
          gradeId: r.gradeId,
          gradeName: r.gradeName,
          gradeOrder: r.gradeOrder,
        });
      }

      // Total del grado (denominador de la tabla de niveles) = estudiantes evaluados.
      acc.gradeTotals.set(r.gradeId, (acc.gradeTotals.get(r.gradeId) ?? 0) + 1);

      // Conteo por nivel (sólo si tiene nivel calculado).
      if (r.performanceLevel) {
        let levelMap = acc.levelCounts.get(r.gradeId);
        if (!levelMap) {
          levelMap = new Map();
          acc.levelCounts.set(r.gradeId, levelMap);
        }
        levelMap.set(r.performanceLevel, (levelMap.get(r.performanceLevel) ?? 0) + 1);
      }

      // Datos por sexo.
      let sex = acc.sex.get(r.gradeId);
      if (!sex) {
        sex = { female: [], male: [], f: 0, m: 0, other: 0 };
        acc.sex.set(r.gradeId, sex);
      }
      if (r.gender === 'F') {
        sex.f += 1;
        if (r.percentage !== null) sex.female.push(r.percentage);
      } else if (r.gender === 'M') {
        sex.m += 1;
        if (r.percentage !== null) sex.male.push(r.percentage);
      } else {
        sex.other += 1;
      }
    }

    const sections: EstablishmentSubjectSection[] = [];
    for (const acc of bySubject.values()) {
      const gradeCols = Array.from(acc.grades.values()).sort(
        (a, b) => a.gradeOrder - b.gradeOrder,
      );

      // Niveles presentes (con al menos una fila), en orden canónico.
      const levelsPresent = new Set<PerformanceLevel>();
      for (const levelMap of acc.levelCounts.values()) {
        for (const level of levelMap.keys()) levelsPresent.add(level);
      }
      const levels = OFFICIAL_REPORT_LEVEL_ORDER.filter((l) => levelsPresent.has(l));

      // Tabla 1.1–1.4: % por grado × nivel.
      const levelDistribution: EstablishmentLevelCell[] = [];
      for (const grade of gradeCols) {
        const total = acc.gradeTotals.get(grade.gradeId) ?? 0;
        const levelMap = acc.levelCounts.get(grade.gradeId);
        if (!levelMap || total === 0) continue;
        for (const level of levels) {
          const count = levelMap.get(level) ?? 0;
          levelDistribution.push({
            gradeId: grade.gradeId,
            level,
            count,
            total,
            percentage: (count / total) * 100,
          });
        }
      }

      // Tabla 1.5–1.8: comparación por sexo.
      const sexComparison: EstablishmentSexComparisonRow[] = gradeCols.map((grade) => {
        const sex = acc.sex.get(grade.gradeId) ?? {
          female: [],
          male: [],
          f: 0,
          m: 0,
          other: 0,
        };
        const outcome = compareSexes(sex.female, sex.male);
        return {
          gradeId: grade.gradeId,
          gradeName: grade.gradeName,
          gradeOrder: grade.gradeOrder,
          result: outcome.result,
          femaleAvg: outcome.femaleAvg,
          maleAvg: outcome.maleAvg,
          femaleN: outcome.femaleN,
          maleN: outcome.maleN,
        };
      });

      // Tabla 1.9: conteo M/H/Total.
      const counts: EstablishmentCountRow[] = gradeCols.map((grade) => {
        const sex = acc.sex.get(grade.gradeId) ?? { f: 0, m: 0, other: 0 };
        return {
          gradeId: grade.gradeId,
          gradeName: grade.gradeName,
          gradeOrder: grade.gradeOrder,
          female: sex.f,
          male: sex.m,
          other: sex.other,
          total: sex.f + sex.m + sex.other,
        };
      });

      sections.push({
        subjectId: acc.subjectId,
        subjectName: acc.subjectName,
        levels,
        grades: gradeCols,
        levelDistribution,
        sexComparison,
        counts,
      });
    }

    // Orden estable por nombre de asignatura.
    return sections.sort((a, b) => a.subjectName.localeCompare(b.subjectName, 'es'));
  }

  private async loadInstrumentMeta(
    tx: Database,
    instrumentIds: string[],
  ): Promise<{ disclaimers: string[]; levelDefinitions: string[] }> {
    if (instrumentIds.length === 0) return { disclaimers: [], levelDefinitions: [] };
    const rows = await tx
      .select({ config: instruments.config })
      .from(instruments)
      .where(inArray(instruments.id, instrumentIds));

    const disclaimers = new Set<string>();
    const levelDefinitions = new Set<string>();
    for (const r of rows) {
      const config = (r.config ?? {}) as Record<string, unknown>;
      collectStrings(config.reportDisclaimers, disclaimers);
      collectStrings(config.levelDefinitions, levelDefinitions);
    }
    return {
      disclaimers: Array.from(disclaimers),
      levelDefinitions: Array.from(levelDefinitions),
    };
  }
}

function collectStrings(raw: unknown, into: Set<string>): void {
  if (Array.isArray(raw)) {
    for (const s of raw) if (typeof s === 'string') into.add(s);
  }
}
