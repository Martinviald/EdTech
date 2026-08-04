import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  academicYears,
  classGroups,
  grades,
  importJobs,
  studentEnrollments,
  students,
  subjectClasses,
  withOrgContext,
} from '@soe/db';
import type { Grade } from '@soe/db';
import {
  normalizeRut,
  parseCursoLabel,
  type ParsedCurso,
  type StudentImportClassGroupRef,
  type StudentImportCommitResponse,
  type StudentImportError,
  type StudentImportPreviewResponse,
  type StudentImportUnknownGrade,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import { chunk, parseStudentRosterCsv, type RawRosterRow } from './students-import.helpers';

type NormalizedRow = {
  rowNumber: number;
  rut: string;
  firstName: string;
  lastName: string;
  curso: ParsedCurso;
};

type ParseOutput = {
  validRows: NormalizedRow[];
  errors: StudentImportError[];
  totalRows: number;
  unknownCursoLabels: Map<string, number[]>;
};

type ResolvedCourse = {
  classGroupId: string;
  ref: StudentImportClassGroupRef;
  existed: boolean;
};

@Injectable()
export class StudentsImportService {
  constructor(@InjectDb() private readonly db: Database) {}

  async preview(orgId: string, file: Buffer): Promise<StudentImportPreviewResponse> {
    const parsed = this.parseCsvOrThrow(file);
    const { validRows, errors, totalRows, unknownCursoLabels } = this.normalizeRows(parsed.rows);

    const academicYearId = await this.requireCurrentAcademicYearId(orgId);

    const cursoLabels = this.uniqueCursoLabels(validRows);
    const courseResolution = await this.resolveCourses(orgId, academicYearId, cursoLabels);

    const existingClassGroups: StudentImportClassGroupRef[] = [];
    const newClassGroups: StudentImportClassGroupRef[] = [];
    for (const r of courseResolution.resolved.values()) {
      if (r.existed) existingClassGroups.push(r.ref);
      else newClassGroups.push(r.ref);
    }

    void unknownCursoLabels;
    const unknownGrades: StudentImportUnknownGrade[] = [];
    for (const label of courseResolution.unknownGradeLabels) {
      const rowNumbers = validRows
        .filter((r) => this.cursoKey(r.curso) === label)
        .map((r) => r.rowNumber);
      unknownGrades.push({ label, rowNumbers });
    }

    return {
      totalRows,
      validRows: validRows.length,
      errors,
      existingClassGroups,
      newClassGroups,
      unknownGrades,
    };
  }

  async commit(
    orgId: string,
    userId: string,
    file: Buffer,
    fileName: string,
    confirmCreateMissingCourses: boolean,
  ): Promise<StudentImportCommitResponse> {
    const parsed = this.parseCsvOrThrow(file);
    const { validRows, errors, totalRows } = this.normalizeRows(parsed.rows);

    const academicYearId = await this.requireCurrentAcademicYearId(orgId);
    const cursoLabels = this.uniqueCursoLabels(validRows);
    const preResolution = await this.resolveCourses(orgId, academicYearId, cursoLabels);

    if (preResolution.unknownGradeLabels.size > 0) {
      throw new BadRequestException({
        message: 'Hay cursos en el CSV que no se pueden mapear a un nivel conocido',
        unknownGrades: Array.from(preResolution.unknownGradeLabels),
      });
    }

    const willCreateCount = Array.from(preResolution.resolved.values()).filter(
      (r) => !r.existed,
    ).length;

    if (willCreateCount > 0 && !confirmCreateMissingCourses) {
      throw new ConflictException({
        message:
          'Se detectaron cursos que aún no existen. Confirma su creación para continuar.',
        newClassGroups: Array.from(preResolution.resolved.values())
          .filter((r) => !r.existed)
          .map((r) => r.ref),
      });
    }

    let inserted = 0;
    let updated = 0;
    let classGroupsCreated = 0;
    const commitErrors: StudentImportError[] = [...errors];

    const jobId = await withOrgContext(this.db, orgId, async (tx) => {
      // Asignaturas que la org ya tiene configuradas para el año vigente:
      // se replican en cada class_group nuevo para que aparezcan en la vista de
      // asignaciones (que parte desde subject_classes).
      const configuredSubjectIds = await tx
        .selectDistinct({ subjectId: subjectClasses.subjectId })
        .from(subjectClasses)
        .innerJoin(classGroups, eq(classGroups.id, subjectClasses.classGroupId))
        .where(
          and(
            eq(classGroups.orgId, orgId),
            eq(subjectClasses.academicYearId, academicYearId),
          ),
        )
        .then((rows) => rows.map((r) => r.subjectId));

      const classGroupIdByLabel = new Map<string, string>();
      for (const [label, r] of preResolution.resolved.entries()) {
        if (r.existed) {
          classGroupIdByLabel.set(label, r.classGroupId);
          continue;
        }
        const [createdRow] = await tx
          .insert(classGroups)
          .values({
            orgId,
            academicYearId,
            gradeId: r.ref.gradeId,
            name: r.ref.section,
          })
          .returning({ id: classGroups.id });
        if (!createdRow) throw new Error('classGroup insert returned no row');
        classGroupIdByLabel.set(label, createdRow.id);
        classGroupsCreated++;

        if (configuredSubjectIds.length > 0) {
          await tx.insert(subjectClasses).values(
            configuredSubjectIds.map((subjectId) => ({
              classGroupId: createdRow.id,
              subjectId,
              academicYearId,
            })),
          );
        }
      }

      for (const batch of chunk(validRows, 500)) {
        const studentValues = batch.map((row) => ({
          orgId,
          rut: row.rut,
          firstName: row.firstName,
          lastName: row.lastName,
        }));

        const upserted = await tx
          .insert(students)
          .values(studentValues)
          .onConflictDoUpdate({
            target: [students.orgId, students.rut],
            set: {
              firstName: sql`excluded.first_name`,
              lastName: sql`excluded.last_name`,
              updatedAt: new Date(),
            },
          })
          .returning({
            id: students.id,
            rut: students.rut,
            createdAt: students.createdAt,
            updatedAt: students.updatedAt,
          });

        const studentIdByRut = new Map<string, string>();
        for (const s of upserted) {
          studentIdByRut.set(s.rut, s.id);
          if (s.createdAt.getTime() === s.updatedAt.getTime()) inserted++;
          else updated++;
        }

        const enrollmentValues = batch
          .map((row) => {
            const studentId = studentIdByRut.get(row.rut);
            const classGroupId = classGroupIdByLabel.get(this.cursoKey(row.curso));
            if (!studentId || !classGroupId) return null;
            return {
              studentId,
              classGroupId,
              academicYearId,
              status: 'active' as const,
            };
          })
          .filter((v): v is NonNullable<typeof v> => v !== null);

        if (enrollmentValues.length > 0) {
          await tx
            .insert(studentEnrollments)
            .values(enrollmentValues)
            .onConflictDoUpdate({
              target: [studentEnrollments.studentId, studentEnrollments.academicYearId],
              set: {
                classGroupId: sql`excluded.class_group_id`,
                status: sql`excluded.status`,
              },
            });
        }
      }

      const status: 'completed' | 'partial' = commitErrors.length > 0 ? 'partial' : 'completed';

      const [jobRow] = await tx
        .insert(importJobs)
        .values({
          orgId,
          type: 'student_roster',
          status,
          fileUrl: null,
          mappingConfig: { fileName, classGroupsCreated },
          result: {
            rowsProcessed: validRows.length,
            errors: commitErrors.length,
            warnings: 0,
          },
          errorLog: commitErrors.map((e) => ({ row: e.rowNumber, message: e.message })),
          createdById: userId,
          completedAt: new Date(),
        })
        .returning({ id: importJobs.id });

      if (!jobRow) throw new Error('importJobs insert returned no row');
      return jobRow.id;
    });

    void totalRows;
    return {
      jobId,
      status: commitErrors.length > 0 ? 'partial' : 'completed',
      inserted,
      updated,
      failed: commitErrors.length,
      classGroupsCreated,
      errors: commitErrors,
    };
  }

  private parseCsvOrThrow(file: Buffer) {
    const parsed = parseStudentRosterCsv(file);
    if (!parsed.ok) {
      throw new BadRequestException({
        message: 'El CSV no contiene las columnas requeridas',
        missingHeaders: parsed.missingHeaders,
      });
    }
    return parsed;
  }

  private normalizeRows(rows: readonly RawRosterRow[]): ParseOutput {
    const validRows: NormalizedRow[] = [];
    const errors: StudentImportError[] = [];
    const unknownCursoLabels = new Map<string, number[]>();

    rows.forEach((raw, idx) => {
      const rowNumber = idx + 2; // +1 by index, +1 to account for header row
      const rutRaw = (raw.RUT ?? '').trim();
      const firstName = (raw.Nombres ?? '').trim();
      const lastName = (raw.Apellidos ?? '').trim();
      const cursoRaw = (raw.Curso ?? '').trim();

      if (!rutRaw && !firstName && !lastName && !cursoRaw) return;

      const rowErrors: StudentImportError[] = [];
      const rut = normalizeRut(rutRaw);
      if (!rut) {
        rowErrors.push({ rowNumber, field: 'RUT', message: `RUT inválido: "${rutRaw}"` });
      }
      if (!firstName) {
        rowErrors.push({ rowNumber, field: 'Nombres', message: 'Falta el nombre' });
      }
      if (!lastName) {
        rowErrors.push({ rowNumber, field: 'Apellidos', message: 'Faltan los apellidos' });
      }

      const curso = parseCursoLabel(cursoRaw);
      if (!curso) {
        rowErrors.push({
          rowNumber,
          field: 'Curso',
          message: `Curso no reconocido: "${cursoRaw}"`,
        });
      }

      if (rowErrors.length > 0) {
        errors.push(...rowErrors);
        return;
      }

      validRows.push({
        rowNumber,
        rut: rut!,
        firstName,
        lastName,
        curso: curso!,
      });
    });

    return { validRows, errors, totalRows: rows.length, unknownCursoLabels };
  }

  private cursoKey(curso: ParsedCurso): string {
    return `${curso.gradeCode}|${curso.section}`;
  }

  private uniqueCursoLabels(rows: readonly NormalizedRow[]): Map<string, ParsedCurso> {
    const map = new Map<string, ParsedCurso>();
    for (const r of rows) {
      const k = this.cursoKey(r.curso);
      if (!map.has(k)) map.set(k, r.curso);
    }
    return map;
  }

  private async requireCurrentAcademicYearId(orgId: string): Promise<string> {
    const [row] = await this.db
      .select({ id: academicYears.id })
      .from(academicYears)
      .where(and(eq(academicYears.orgId, orgId), eq(academicYears.isCurrent, true)))
      .limit(1);

    if (!row) {
      throw new BadRequestException(
        'Debes configurar el año académico antes de importar alumnos.',
      );
    }
    return row.id;
  }

  private async resolveCourses(
    orgId: string,
    academicYearId: string,
    labels: Map<string, ParsedCurso>,
  ): Promise<{
    resolved: Map<string, ResolvedCourse>;
    unknownGradeLabels: Set<string>;
  }> {
    const resolved = new Map<string, ResolvedCourse>();
    const unknownGradeLabels = new Set<string>();

    if (labels.size === 0) {
      return { resolved, unknownGradeLabels };
    }

    const wantedGradeCodes = Array.from(new Set(Array.from(labels.values()).map((c) => c.gradeCode)));
    const gradeRows: Grade[] = await this.db
      .select()
      .from(grades)
      .where(inArray(grades.code, wantedGradeCodes));
    const gradeByCode = new Map(gradeRows.map((g) => [g.code, g]));

    const existingClassGroups = await this.db
      .select({
        id: classGroups.id,
        gradeId: classGroups.gradeId,
        name: classGroups.name,
      })
      .from(classGroups)
      .where(
        and(eq(classGroups.orgId, orgId), eq(classGroups.academicYearId, academicYearId)),
      );

    const existingKey = (gradeId: string, section: string) => `${gradeId}|${section}`;
    const existingByKey = new Map<string, string>();
    for (const cg of existingClassGroups) {
      existingByKey.set(existingKey(cg.gradeId, cg.name), cg.id);
    }

    for (const [label, curso] of labels.entries()) {
      const grade = gradeByCode.get(curso.gradeCode);
      if (!grade) {
        unknownGradeLabels.add(label);
        continue;
      }
      const key = existingKey(grade.id, curso.section);
      const existingId = existingByKey.get(key);
      const ref: StudentImportClassGroupRef = {
        label: curso.normalized,
        gradeId: grade.id,
        gradeName: grade.name,
        section: curso.section,
      };
      if (existingId) {
        resolved.set(label, { classGroupId: existingId, ref, existed: true });
      } else {
        resolved.set(label, { classGroupId: '', ref, existed: false });
      }
    }

    return { resolved, unknownGradeLabels };
  }
}
