import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import {
  assessmentCourseAssignments,
  assessments,
  classGroups,
  printedSheets,
  sheetLayouts,
  sheetPrintRuns,
  sheetScanBatches,
  studentEnrollments,
  students,
  withOrgContext,
} from '@soe/db';
import type {
  CreatePrintRunDto,
  PaginatedResponse,
  PrintRunAssessmentOption,
  PrintRunModel,
  PrintRunQueryDto,
  UpdatePrintRunDto,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import { renderSheetsPdf, type PrintableSheetInfo } from './sheet-print.helpers';

type RunRow = {
  id: string;
  layoutId: string;
  layoutVersion: number;
  instrumentId: string;
  classGroupId: string | null;
  classGroupName: string | null;
  assessmentId: string | null;
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
        })
        .from(sheetLayouts)
        .where(and(eq(sheetLayouts.orgId, orgId), eq(sheetLayouts.id, dto.layoutId)))
        .limit(1);
      if (!layout) throw new NotFoundException('Layout de hoja no encontrado');

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
        : await this.createAssessmentForRun(tx, orgId, userId, layout.instrumentId, classGroup);

      const sheetCount = roster.length + dto.spareCount;

      const [run] = await tx
        .insert(sheetPrintRuns)
        .values({
          orgId,
          layoutId: layout.id,
          classGroupId: classGroup.id,
          assessmentId,
          spareCount: dto.spareCount,
          sheetCount,
          createdById: userId,
        })
        .returning({
          id: sheetPrintRuns.id,
          assessmentId: sheetPrintRuns.assessmentId,
          spareCount: sheetPrintRuns.spareCount,
          sheetCount: sheetPrintRuns.sheetCount,
          pdfFileId: sheetPrintRuns.pdfFileId,
          createdById: sheetPrintRuns.createdById,
          createdAt: sheetPrintRuns.createdAt,
        });
      if (!run) throw new Error('sheet_print_runs insert returned no row');

      const sheetValues = [
        ...roster.map((student, index) => ({
          orgId,
          printRunId: run.id,
          studentId: student.id,
          sequence: index + 1,
        })),
        ...Array.from({ length: dto.spareCount }, (_, index) => ({
          orgId,
          printRunId: run.id,
          studentId: null,
          sequence: roster.length + index + 1,
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
        spareCount: run.spareCount,
        sheetCount: run.sheetCount,
        pdfFileId: run.pdfFileId,
        createdById: run.createdById,
        createdAt: run.createdAt,
      };
    });
  }

  async getRun(orgId: string, runId: string): Promise<PrintRunModel> {
    const row = await withOrgContext(this.db, orgId, (tx) =>
      this.selectRuns(tx, orgId, eq(sheetPrintRuns.id, runId)).then((rows) => rows[0]),
    );
    if (!row) throw new NotFoundException('Tirada de impresión no encontrada');
    return this.toModel(row);
  }

  async updateRun(orgId: string, runId: string, dto: UpdatePrintRunDto): Promise<PrintRunModel> {
    await withOrgContext(this.db, orgId, async (tx) => {
      const [run] = await tx
        .select({
          id: sheetPrintRuns.id,
          assessmentId: sheetPrintRuns.assessmentId,
          instrumentId: sheetLayouts.instrumentId,
        })
        .from(sheetPrintRuns)
        .innerJoin(sheetLayouts, eq(sheetLayouts.id, sheetPrintRuns.layoutId))
        .where(and(eq(sheetPrintRuns.orgId, orgId), eq(sheetPrintRuns.id, runId)))
        .limit(1);
      if (!run) throw new NotFoundException('Tirada de impresión no encontrada');

      if (run.assessmentId !== dto.assessmentId) {
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

      await this.assertAssessmentUsable(tx, orgId, dto.assessmentId, run.instrumentId);

      await tx
        .update(sheetPrintRuns)
        .set({ assessmentId: dto.assessmentId })
        .where(and(eq(sheetPrintRuns.orgId, orgId), eq(sheetPrintRuns.id, runId)));
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

  private async createAssessmentForRun(
    tx: Database,
    orgId: string,
    userId: string,
    instrumentId: string,
    classGroup: { id: string; name: string },
  ): Promise<string> {
    const [created] = await tx
      .insert(assessments)
      .values({
        orgId,
        instrumentId,
        name: `${classGroup.name} · hojas propias ${new Date().toISOString().slice(0, 10)}`,
        mode: 'paper',
        status: 'scheduled',
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
    const { spec, specHash, sheets } = await withOrgContext(this.db, orgId, async (tx) => {
      const [run] = await tx
        .select({
          id: sheetPrintRuns.id,
          spec: sheetLayouts.spec,
          specHash: sheetLayouts.specHash,
          classGroupName: classGroups.name,
        })
        .from(sheetPrintRuns)
        .innerJoin(sheetLayouts, eq(sheetLayouts.id, sheetPrintRuns.layoutId))
        .leftJoin(classGroups, eq(classGroups.id, sheetPrintRuns.classGroupId))
        .where(and(eq(sheetPrintRuns.orgId, orgId), eq(sheetPrintRuns.id, runId)))
        .limit(1);
      if (!run) throw new NotFoundException('Tirada de impresión no encontrada');

      const sheetRows = await tx
        .select({
          id: printedSheets.id,
          sequence: printedSheets.sequence,
          firstName: students.firstName,
          lastName: students.lastName,
        })
        .from(printedSheets)
        .leftJoin(students, eq(students.id, printedSheets.studentId))
        .where(and(eq(printedSheets.orgId, orgId), eq(printedSheets.printRunId, runId)))
        .orderBy(asc(printedSheets.sequence));

      const printable: PrintableSheetInfo[] = sheetRows.map((sheet) => ({
        printedSheetId: sheet.id,
        sequence: sheet.sequence,
        studentName:
          sheet.lastName !== null && sheet.firstName !== null
            ? `${sheet.lastName}, ${sheet.firstName}`
            : null,
        classGroupName: run.classGroupName,
      }));

      return { spec: run.spec, specHash: run.specHash, sheets: printable };
    });

    if (sheets.length === 0) {
      throw new BadRequestException('La tirada no tiene hojas registradas para imprimir.');
    }

    const bytes = await renderSheetsPdf(spec, specHash, sheets);
    return Buffer.from(bytes);
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
        spareCount: sheetPrintRuns.spareCount,
        sheetCount: sheetPrintRuns.sheetCount,
        pdfFileId: sheetPrintRuns.pdfFileId,
        createdById: sheetPrintRuns.createdById,
        createdAt: sheetPrintRuns.createdAt,
      })
      .from(sheetPrintRuns)
      .innerJoin(sheetLayouts, eq(sheetLayouts.id, sheetPrintRuns.layoutId))
      .leftJoin(classGroups, eq(classGroups.id, sheetPrintRuns.classGroupId))
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
      spareCount: row.spareCount,
      sheetCount: row.sheetCount,
      pdfFileId: row.pdfFileId,
      createdById: row.createdById,
      createdAt: row.createdAt,
    };
  }
}
