import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  assessmentCourseAssignments,
  assessmentForms,
  assessments,
  classGroups,
  grades,
  instruments,
  subjects,
  printedSheets,
  sheetLayouts,
  sheetPrintRuns,
  sheetScanBatches,
  studentEnrollments,
  students,
  withOrgContext,
} from '@soe/db';
import { parseSheetDate, todaySheetDate } from '@soe/types';
import type {
  AssessmentFormListResponse,
  CreatePrintRunDto,
  PaginatedResponse,
  PrintRunAssessmentOption,
  PrintRunModel,
  PrintRunQueryDto,
  UpdatePrintRunDto,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import { identityModeOf } from './sheet-layout.helpers';
import {
  buildInstrumentLabel,
  renderSheetsPdf,
  type PrintableSheetInfo,
} from './sheet-print.helpers';

type RunRow = {
  id: string;
  layoutId: string;
  layoutVersion: number;
  instrumentId: string;
  classGroupId: string | null;
  classGroupName: string | null;
  assessmentId: string | null;
  assessmentFormId: string | null;
  administeredAt: Date | null;
  spareCount: number;
  sheetCount: number;
  pdfFileId: string | null;
  createdById: string | null;
  createdAt: Date;
};

@Injectable()
export class SheetPrintService {
  constructor(@InjectDb() private readonly db: Database) {}

  async createRun(orgId: string, userId: string, dto: CreatePrintRunDto): Promise<PrintRunModel> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const [layout] = await tx
        .select({
          id: sheetLayouts.id,
          version: sheetLayouts.version,
          instrumentId: sheetLayouts.instrumentId,
          spec: sheetLayouts.spec,
        })
        .from(sheetLayouts)
        .where(and(eq(sheetLayouts.orgId, orgId), eq(sheetLayouts.id, dto.layoutId)))
        .limit(1);
      if (!layout) throw new NotFoundException('Layout de hoja no encontrado');

      const form = dto.assessmentFormId
        ? await this.requireRunForm(
            tx,
            orgId,
            dto.assessmentFormId,
            layout.instrumentId,
            dto.assessmentId ?? null,
          )
        : null;

      const [classGroup] = await tx
        .select({ id: classGroups.id, name: classGroups.name })
        .from(classGroups)
        .where(and(eq(classGroups.orgId, orgId), eq(classGroups.id, dto.classGroupId)))
        .limit(1);
      if (!classGroup) throw new NotFoundException('Curso no encontrado');

      const roster = await tx
        .select({ id: students.id })
        .from(students)
        .innerJoin(studentEnrollments, eq(studentEnrollments.studentId, students.id))
        .where(
          and(
            eq(students.orgId, orgId),
            isNull(students.deletedAt),
            eq(studentEnrollments.classGroupId, dto.classGroupId),
            eq(studentEnrollments.status, 'active'),
          ),
        )
        .orderBy(asc(students.lastName), asc(students.firstName));

      if (roster.length === 0) {
        throw new BadRequestException('El curso no tiene alumnos activos para imprimir hojas.');
      }

      const assessmentId = dto.assessmentId
        ? await this.assertAssessmentUsable(tx, orgId, dto.assessmentId, layout.instrumentId)
        : (form?.assessmentId ??
          (await this.createAssessmentForRun(
            tx,
            orgId,
            userId,
            layout.instrumentId,
            classGroup,
            dto.administeredAt ?? null,
          )));

      if (dto.assessmentId || form) {
        await this.applyAdministeredAt(tx, orgId, assessmentId, dto.administeredAt);
      }

      const sheetCount = roster.length + dto.spareCount;
      const genericSheets = identityModeOf(layout.spec) === 'rut_bubbles';

      const [run] = await tx
        .insert(sheetPrintRuns)
        .values({
          orgId,
          layoutId: layout.id,
          classGroupId: classGroup.id,
          assessmentId,
          assessmentFormId: form?.id ?? null,
          spareCount: dto.spareCount,
          sheetCount,
          createdById: userId,
        })
        .returning({
          id: sheetPrintRuns.id,
          assessmentId: sheetPrintRuns.assessmentId,
          assessmentFormId: sheetPrintRuns.assessmentFormId,
          spareCount: sheetPrintRuns.spareCount,
          sheetCount: sheetPrintRuns.sheetCount,
          pdfFileId: sheetPrintRuns.pdfFileId,
          createdById: sheetPrintRuns.createdById,
          createdAt: sheetPrintRuns.createdAt,
        });
      if (!run) throw new Error('sheet_print_runs insert returned no row');

      const shortCodes = await this.pickShortCodes(tx, orgId, sheetCount);
      const sheetValues = genericSheets
        ? Array.from({ length: sheetCount }, (_, index) => ({
            orgId,
            printRunId: run.id,
            studentId: null,
            sequence: index + 1,
            shortCode: shortCodes[index],
          }))
        : [
            ...roster.map((student, index) => ({
              orgId,
              printRunId: run.id,
              studentId: student.id,
              sequence: index + 1,
              shortCode: shortCodes[index],
            })),
            ...Array.from({ length: dto.spareCount }, (_, index) => ({
              orgId,
              printRunId: run.id,
              studentId: null,
              sequence: roster.length + index + 1,
              shortCode: shortCodes[roster.length + index],
            })),
          ];
      await tx.insert(printedSheets).values(sheetValues);

      return {
        id: run.id,
        layoutId: layout.id,
        layoutVersion: layout.version,
        instrumentId: layout.instrumentId,
        classGroupId: classGroup.id,
        classGroupName: classGroup.name,
        assessmentId: run.assessmentId,
        assessmentFormId: run.assessmentFormId,
        administeredAt: dto.administeredAt ? parseSheetDate(dto.administeredAt) : null,
        spareCount: run.spareCount,
        sheetCount: run.sheetCount,
        pdfFileId: run.pdfFileId,
        createdById: run.createdById,
        createdAt: run.createdAt,
      };
    });
  }

  async listForms(orgId: string, layoutId: string): Promise<AssessmentFormListResponse> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const [layout] = await tx
        .select({ id: sheetLayouts.id, instrumentId: sheetLayouts.instrumentId })
        .from(sheetLayouts)
        .where(and(eq(sheetLayouts.orgId, orgId), eq(sheetLayouts.id, layoutId)))
        .limit(1);
      if (!layout) throw new NotFoundException('Layout de hoja no encontrado');

      const rows = await tx
        .select({
          id: assessmentForms.id,
          name: assessmentForms.name,
          assessmentId: assessmentForms.assessmentId,
          assessmentName: assessments.name,
          createdAt: assessmentForms.createdAt,
        })
        .from(assessmentForms)
        .innerJoin(assessments, eq(assessments.id, assessmentForms.assessmentId))
        .where(and(eq(assessments.orgId, orgId), eq(assessments.instrumentId, layout.instrumentId)))
        .orderBy(asc(assessmentForms.name), asc(assessmentForms.createdAt));

      return { data: rows };
    });
  }

  async getRun(orgId: string, runId: string): Promise<PrintRunModel> {
    const row = await withOrgContext(this.db, orgId, (tx) =>
      this.selectRuns(tx, orgId, eq(sheetPrintRuns.id, runId)).then((rows) => rows[0]),
    );
    if (!row) throw new NotFoundException('Tirada de impresión no encontrada');
    return this.toModel(row);
  }

  async updateRun(
    orgId: string,
    userId: string,
    runId: string,
    dto: UpdatePrintRunDto,
  ): Promise<PrintRunModel> {
    await withOrgContext(this.db, orgId, async (tx) => {
      const [run] = await tx
        .select({
          id: sheetPrintRuns.id,
          assessmentId: sheetPrintRuns.assessmentId,
          instrumentId: sheetLayouts.instrumentId,
          classGroupId: sheetPrintRuns.classGroupId,
          classGroupName: classGroups.name,
        })
        .from(sheetPrintRuns)
        .innerJoin(sheetLayouts, eq(sheetLayouts.id, sheetPrintRuns.layoutId))
        .leftJoin(classGroups, eq(classGroups.id, sheetPrintRuns.classGroupId))
        .where(and(eq(sheetPrintRuns.orgId, orgId), eq(sheetPrintRuns.id, runId)))
        .limit(1);
      if (!run) throw new NotFoundException('Tirada de impresión no encontrada');

      const requestedAssessmentId = 'assessmentId' in dto ? dto.assessmentId : null;
      const wantsNewAssessment = 'createAssessment' in dto;
      const changesAssessment =
        requestedAssessmentId !== null
          ? run.assessmentId !== requestedAssessmentId
          : wantsNewAssessment;

      if (changesAssessment) {
        const [confirmed] = await tx
          .select({ id: sheetScanBatches.id })
          .from(sheetScanBatches)
          .where(
            and(
              eq(sheetScanBatches.orgId, orgId),
              eq(sheetScanBatches.printRunId, runId),
              eq(sheetScanBatches.status, 'confirmed'),
            ),
          )
          .limit(1);
        if (confirmed) {
          throw new ConflictException(
            'Esta tirada ya tiene un lote confirmado: no se puede cambiar su evaluación. ' +
              'Genera una tirada nueva si necesitas apuntar a otra evaluación.',
          );
        }
      }

      const administeredAt = 'administeredAt' in dto ? dto.administeredAt : undefined;

      if (requestedAssessmentId !== null) {
        const assessmentId = await this.assertAssessmentUsable(
          tx,
          orgId,
          requestedAssessmentId,
          run.instrumentId,
        );
        await this.applyAdministeredAt(tx, orgId, assessmentId, administeredAt);
        await this.setRunAssessment(tx, orgId, runId, assessmentId);
        return;
      }

      if (wantsNewAssessment) {
        const assessmentId = await this.createAssessmentForRun(
          tx,
          orgId,
          userId,
          run.instrumentId,
          this.requireClassGroup(run),
          administeredAt ?? null,
        );
        await this.setRunAssessment(tx, orgId, runId, assessmentId);
        return;
      }

      if (!run.assessmentId) {
        throw new BadRequestException(
          'La tirada aún no tiene una evaluación asociada: asócia una antes de fijar la fecha de aplicación.',
        );
      }
      await this.applyAdministeredAt(tx, orgId, run.assessmentId, administeredAt);
    });

    return this.getRun(orgId, runId);
  }

  async listAssessmentOptions(
    orgId: string,
    instrumentId: string,
  ): Promise<PrintRunAssessmentOption[]> {
    return withOrgContext(this.db, orgId, (tx) =>
      tx
        .select({
          id: assessments.id,
          name: assessments.name,
          status: assessments.status,
          administeredAt: assessments.administeredAt,
          createdAt: assessments.createdAt,
        })
        .from(assessments)
        .where(and(eq(assessments.orgId, orgId), eq(assessments.instrumentId, instrumentId)))
        .orderBy(desc(assessments.createdAt))
        .limit(100),
    );
  }

  private async assertAssessmentUsable(
    tx: Database,
    orgId: string,
    assessmentId: string,
    instrumentId: string,
  ): Promise<string> {
    const [assessment] = await tx
      .select({ id: assessments.id, instrumentId: assessments.instrumentId })
      .from(assessments)
      .where(and(eq(assessments.orgId, orgId), eq(assessments.id, assessmentId)))
      .limit(1);
    if (!assessment) throw new NotFoundException('Evaluación no encontrada');
    if (assessment.instrumentId !== instrumentId) {
      throw new BadRequestException(
        'La evaluación pertenece a otro instrumento que el del layout de esta tirada.',
      );
    }
    return assessment.id;
  }

  private requireClassGroup(run: { classGroupId: string | null; classGroupName: string | null }): {
    id: string;
    name: string;
  } {
    if (!run.classGroupId || !run.classGroupName) {
      throw new BadRequestException(
        'La tirada no tiene un curso asociado: no se puede crear su evaluación automáticamente.',
      );
    }
    return { id: run.classGroupId, name: run.classGroupName };
  }

  private async setRunAssessment(
    tx: Database,
    orgId: string,
    runId: string,
    assessmentId: string,
  ): Promise<void> {
    await tx
      .update(sheetPrintRuns)
      .set({ assessmentId })
      .where(and(eq(sheetPrintRuns.orgId, orgId), eq(sheetPrintRuns.id, runId)));
  }

  private async applyAdministeredAt(
    tx: Database,
    orgId: string,
    assessmentId: string,
    administeredAt: string | null | undefined,
  ): Promise<void> {
    if (administeredAt === undefined) return;
    await tx
      .update(assessments)
      .set({ administeredAt: administeredAt === null ? null : parseSheetDate(administeredAt) })
      .where(and(eq(assessments.orgId, orgId), eq(assessments.id, assessmentId)));
  }

  private async createAssessmentForRun(
    tx: Database,
    orgId: string,
    userId: string,
    instrumentId: string,
    classGroup: { id: string; name: string },
    administeredAt: string | null,
  ): Promise<string> {
    const [created] = await tx
      .insert(assessments)
      .values({
        orgId,
        instrumentId,
        name: `${classGroup.name} · hojas propias ${administeredAt ?? todaySheetDate()}`,
        mode: 'paper',
        status: 'scheduled',
        administeredAt: administeredAt === null ? null : parseSheetDate(administeredAt),
        administeredById: userId,
        config: { source: 'sheet_print_run' },
      })
      .returning({ id: assessments.id });
    if (!created) throw new Error('assessments insert returned no row');

    await tx
      .insert(assessmentCourseAssignments)
      .values({ assessmentId: created.id, classGroupId: classGroup.id });

    return created.id;
  }

  async list(orgId: string, query: PrintRunQueryDto): Promise<PaginatedResponse<PrintRunModel>> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const where = and(
        eq(sheetPrintRuns.orgId, orgId),
        query.layoutId ? eq(sheetPrintRuns.layoutId, query.layoutId) : undefined,
        query.instrumentId ? eq(sheetLayouts.instrumentId, query.instrumentId) : undefined,
      );

      const [countRow] = await tx
        .select({ total: sql<number>`count(*)` })
        .from(sheetPrintRuns)
        .innerJoin(sheetLayouts, eq(sheetLayouts.id, sheetPrintRuns.layoutId))
        .where(where);

      const rows = await this.selectRuns(tx, orgId, where, query);

      return {
        data: rows.map((row) => this.toModel(row)),
        total: Number(countRow?.total ?? 0),
        page: query.page,
        limit: query.limit,
      };
    });
  }

  async renderPdf(orgId: string, runId: string): Promise<Buffer> {
    const printedOn = parseSheetDate(todaySheetDate());
    const { spec, specHash, sheets } = await withOrgContext(this.db, orgId, async (tx) => {
      const [run] = await tx
        .select({
          id: sheetPrintRuns.id,
          spec: sheetLayouts.spec,
          specHash: sheetLayouts.specHash,
          classGroupName: classGroups.name,
          administeredAt: assessments.administeredAt,
          instrumentName: instruments.name,
          instrumentYear: instruments.year,
          instrumentApplicationPeriod: instruments.applicationPeriod,
          subjectName: subjects.name,
          gradeName: grades.name,
        })
        .from(sheetPrintRuns)
        .innerJoin(sheetLayouts, eq(sheetLayouts.id, sheetPrintRuns.layoutId))
        .leftJoin(classGroups, eq(classGroups.id, sheetPrintRuns.classGroupId))
        .leftJoin(assessments, eq(assessments.id, sheetPrintRuns.assessmentId))
        .leftJoin(instruments, eq(instruments.id, sheetLayouts.instrumentId))
        .leftJoin(subjects, eq(subjects.id, instruments.subjectId))
        .leftJoin(grades, eq(grades.id, instruments.gradeId))
        .where(and(eq(sheetPrintRuns.orgId, orgId), eq(sheetPrintRuns.id, runId)))
        .limit(1);
      if (!run) throw new NotFoundException('Tirada de impresión no encontrada');

      const instrumentLabel = run.instrumentName
        ? buildInstrumentLabel({
            name: run.instrumentName,
            subjectName: run.subjectName ?? null,
            gradeName: run.gradeName ?? null,
            year: run.instrumentYear ?? null,
            applicationPeriod: run.instrumentApplicationPeriod ?? null,
          })
        : null;
      const administeredAt = run.administeredAt ?? printedOn;

      const sheetRows = await tx
        .select({
          id: printedSheets.id,
          sequence: printedSheets.sequence,
          shortCode: printedSheets.shortCode,
          firstName: students.firstName,
          lastName: students.lastName,
        })
        .from(printedSheets)
        .leftJoin(students, eq(students.id, printedSheets.studentId))
        .where(and(eq(printedSheets.orgId, orgId), eq(printedSheets.printRunId, runId)))
        .orderBy(asc(printedSheets.sequence));

      const printable: PrintableSheetInfo[] = sheetRows.map((sheet) => {
        const studentName =
          sheet.lastName !== null && sheet.firstName !== null
            ? `${sheet.lastName}, ${sheet.firstName}`
            : null;
        return {
          printedSheetId: sheet.id,
          sequence: sheet.sequence,
          shortCode: sheet.shortCode,
          studentName,
          classGroupName: run.classGroupName,
          listNumber: studentName === null ? null : sheet.sequence,
          instrumentLabel,
          administeredAt,
        };
      });

      return { spec: run.spec, specHash: run.specHash, sheets: printable };
    });

    if (sheets.length === 0) {
      throw new BadRequestException('La tirada no tiene hojas registradas para imprimir.');
    }

    const bytes = await renderSheetsPdf(spec, specHash, sheets);
    return Buffer.from(bytes);
  }

  private async pickShortCodes(tx: Database, orgId: string, count: number): Promise<number[]> {
    const picked = new Set<number>();
    for (let attempt = 0; attempt < 5 && picked.size < count; attempt += 1) {
      const candidates = new Set<number>();
      while (candidates.size < count - picked.size) {
        candidates.add(randomInt(1, 0x1_0000_0000));
      }
      const taken = await tx
        .select({ shortCode: printedSheets.shortCode })
        .from(printedSheets)
        .where(
          and(eq(printedSheets.orgId, orgId), inArray(printedSheets.shortCode, [...candidates])),
        );
      const takenSet = new Set(taken.map((row) => row.shortCode));
      for (const candidate of candidates) {
        if (!takenSet.has(candidate) && picked.size < count) picked.add(candidate);
      }
    }
    if (picked.size < count) {
      throw new ConflictException(
        'No se pudieron asignar códigos únicos a las hojas. Vuelve a intentar la tirada.',
      );
    }
    return [...picked];
  }

  private async requireRunForm(
    tx: Database,
    orgId: string,
    assessmentFormId: string,
    instrumentId: string,
    requestedAssessmentId: string | null,
  ): Promise<{ id: string; assessmentId: string }> {
    const [form] = await tx
      .select({
        id: assessmentForms.id,
        assessmentId: assessmentForms.assessmentId,
        instrumentId: assessments.instrumentId,
      })
      .from(assessmentForms)
      .innerJoin(assessments, eq(assessments.id, assessmentForms.assessmentId))
      .where(and(eq(assessmentForms.id, assessmentFormId), eq(assessments.orgId, orgId)))
      .limit(1);
    if (!form) throw new NotFoundException('Forma de evaluación no encontrada');
    if (form.instrumentId !== instrumentId) {
      throw new BadRequestException(
        'La forma seleccionada pertenece a una evaluación de otro instrumento: elige una forma cuya evaluación use el instrumento de este layout.',
      );
    }
    if (requestedAssessmentId !== null && requestedAssessmentId !== form.assessmentId) {
      throw new BadRequestException(
        'La forma seleccionada no pertenece a la evaluación indicada para la tirada.',
      );
    }
    return { id: form.id, assessmentId: form.assessmentId };
  }

  private selectRuns(
    tx: Database,
    orgId: string,
    where: SQL | undefined,
    pagination?: { page: number; limit: number },
  ): Promise<RunRow[]> {
    const base = tx
      .select({
        id: sheetPrintRuns.id,
        layoutId: sheetPrintRuns.layoutId,
        layoutVersion: sheetLayouts.version,
        instrumentId: sheetLayouts.instrumentId,
        classGroupId: sheetPrintRuns.classGroupId,
        classGroupName: classGroups.name,
        assessmentId: sheetPrintRuns.assessmentId,
        assessmentFormId: sheetPrintRuns.assessmentFormId,
        administeredAt: assessments.administeredAt,
        spareCount: sheetPrintRuns.spareCount,
        sheetCount: sheetPrintRuns.sheetCount,
        pdfFileId: sheetPrintRuns.pdfFileId,
        createdById: sheetPrintRuns.createdById,
        createdAt: sheetPrintRuns.createdAt,
      })
      .from(sheetPrintRuns)
      .innerJoin(sheetLayouts, eq(sheetLayouts.id, sheetPrintRuns.layoutId))
      .leftJoin(classGroups, eq(classGroups.id, sheetPrintRuns.classGroupId))
      .leftJoin(assessments, eq(assessments.id, sheetPrintRuns.assessmentId))
      .where(and(eq(sheetPrintRuns.orgId, orgId), where))
      .orderBy(desc(sheetPrintRuns.createdAt));

    if (!pagination) return base.limit(1);
    return base.limit(pagination.limit).offset((pagination.page - 1) * pagination.limit);
  }

  private toModel(row: RunRow): PrintRunModel {
    return {
      id: row.id,
      layoutId: row.layoutId,
      layoutVersion: row.layoutVersion,
      instrumentId: row.instrumentId,
      classGroupId: row.classGroupId,
      classGroupName: row.classGroupName,
      assessmentId: row.assessmentId,
      assessmentFormId: row.assessmentFormId,
      administeredAt: row.administeredAt ?? null,
      spareCount: row.spareCount,
      sheetCount: row.sheetCount,
      pdfFileId: row.pdfFileId,
      createdById: row.createdById,
      createdAt: row.createdAt,
    };
  }
}
