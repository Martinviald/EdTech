import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNull, isNotNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  files,
  printedSheets,
  sheetLayouts,
  sheetPrintRuns,
  sheetScanBatches,
  sheetScanMarks,
  sheetScans,
  students,
  withOrgContext,
  type FileRecord,
} from '@soe/db';
import type {
  AssignScanIdentityDto,
  ConfirmBatchResponse,
  DiscardScanDto,
  LayoutSpec,
  MarkState,
  PageQuality,
  ReviewMarkDto,
  ReviewMarkModel,
  ReviewQueueModel,
  ReviewScanModel,
  SheetScanState,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import type { AnswerSheetsService } from '../answer-sheets/answer-sheets.service';
import type { AnswerSheetPreviewStore } from '../answer-sheets/lib/preview-store';
import type { ParserResult } from '../answer-sheets/lib/parsers/parser.types';
import { FilesService } from '../files/files.service';
import { toParserResult, type ConfirmedScanInput } from './scan-result.adapter';

export const ANSWER_SHEET_CONFIRMER = 'ANSWER_SHEET_CONFIRMER';

export interface AnswerSheetConfirmInput {
  orgId: string;
  instrumentId: string;
  classGroupId: string | null;
  assessmentId: string;
  parserResult: ParserResult;
}

export interface AnswerSheetConfirmOutcome {
  jobId: string;
  responsesCreated: number;
}

export interface AnswerSheetConfirmer {
  confirmParserResult(
    user: JwtPayload,
    input: AnswerSheetConfirmInput,
  ): Promise<AnswerSheetConfirmOutcome>;
}

export function createAnswerSheetConfirmer(
  answerSheets: AnswerSheetsService,
  previewStore: AnswerSheetPreviewStore,
): AnswerSheetConfirmer {
  return {
    async confirmParserResult(user, input) {
      const entry = previewStore.set({
        orgId: input.orgId,
        userId: user.userId,
        format: 'generic_csv',
        instrumentId: input.instrumentId,
        classGroupId: input.classGroupId,
        assessmentId: input.assessmentId,
        assessmentName: null,
        columnMapping: null,
        rows: input.parserResult.rows,
        detectedColumns: input.parserResult.detectedColumns,
        warnings: input.parserResult.warnings,
      });
      const result = await answerSheets.confirm(
        { ...user, orgId: input.orgId },
        {
          previewToken: entry.previewToken,
          createAssessment: false,
          assessmentId: input.assessmentId,
          skipErrorRows: false,
        },
      );
      return { jobId: result.jobId, responsesCreated: result.responsesCreated };
    },
  };
}

const PENDING_MARK_STATES: MarkState[] = ['multiple', 'ambiguous'];
const PENDING_SCAN_STATES: SheetScanState[] = ['quality_rejected', 'identity_unresolved'];

type ScanQueueRow = {
  scanId: string;
  state: SheetScanState;
  quality: PageQuality;
  pageIndex: number;
  sheetSequence: number | null;
  sheetStudentId: string | null;
  resolvedStudentId: string | null;
  identityConfidence: string | null;
  thumbFileId: string | null;
  sheetFirstName: string | null;
  sheetLastName: string | null;
  resolvedFirstName: string | null;
  resolvedLastName: string | null;
};

type MarkQueueRow = {
  markId: string;
  scanId: string;
  fieldId: string;
  printedNumber: string;
  state: MarkState;
  value: string | null;
  fill: string;
  threshold: string;
  margin: string;
  cropFileId: string | null;
  reviewedValue: string | null;
  reviewedById: string | null;
};

type ConfirmMarkRow = {
  markId: string;
  scanId: string;
  printedNumber: string;
  state: MarkState;
  value: string | null;
  reviewedValue: string | null;
  reviewedAt: Date | null;
};

type SheetGroup = {
  sequence: number;
  studentId: string | null;
  pages: Set<number>;
  marks: ConfirmMarkRow[];
};

@Injectable()
export class ScanReviewService {
  constructor(
    @InjectDb() private readonly db: Database,
    @Inject(ANSWER_SHEET_CONFIRMER) private readonly answerSheetConfirmer: AnswerSheetConfirmer,
    private readonly filesService: FilesService,
  ) {}

  async getQueue(orgId: string, batchId: string): Promise<ReviewQueueModel> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const [batch] = await tx
        .select({ id: sheetScanBatches.id, spec: sheetLayouts.spec })
        .from(sheetScanBatches)
        .innerJoin(sheetPrintRuns, eq(sheetPrintRuns.id, sheetScanBatches.printRunId))
        .innerJoin(sheetLayouts, eq(sheetLayouts.id, sheetPrintRuns.layoutId))
        .where(and(eq(sheetScanBatches.orgId, orgId), eq(sheetScanBatches.id, batchId)))
        .limit(1);
      if (!batch) throw new NotFoundException('Lote de escaneo no encontrado');

      const scanRows = await this.selectBatchScans(tx, orgId, batchId);
      const markRows = await this.selectPendingMarks(tx, orgId, batchId);

      const fileIds: string[] = [];
      for (const scan of scanRows) {
        if (PENDING_SCAN_STATES.includes(scan.state) && scan.thumbFileId) {
          fileIds.push(scan.thumbFileId);
        }
      }
      for (const mark of markRows) {
        if (mark.cropFileId) fileIds.push(mark.cropFileId);
      }
      const urlByFileId = await this.buildFileUrlIndex(tx, orgId, fileIds);

      const scanById = new Map<string, ScanQueueRow>();
      const qualityRejected: ReviewScanModel[] = [];
      const identityUnresolved: ReviewScanModel[] = [];
      for (const scan of scanRows) {
        scanById.set(scan.scanId, scan);
        if (scan.state === 'quality_rejected') {
          qualityRejected.push(this.toReviewScanModel(scan, urlByFileId));
        } else if (scan.state === 'identity_unresolved') {
          identityUnresolved.push(this.toReviewScanModel(scan, urlByFileId));
        }
      }

      const optionsByFieldId = this.buildOptionsIndex(batch.spec);
      const ambiguousMarks = markRows
        .map((mark) => {
          const scan = scanById.get(mark.scanId);
          return this.toReviewMarkModel(
            mark,
            scan ? this.studentNameOf(scan) : null,
            optionsByFieldId.get(mark.fieldId) ?? [],
            mark.cropFileId ? (urlByFileId.get(mark.cropFileId) ?? null) : null,
          );
        })
        .sort((a, b) => a.margin - b.margin);

      return { batchId, qualityRejected, identityUnresolved, ambiguousMarks };
    });
  }

  async resolveMark(
    orgId: string,
    userId: string,
    markId: string,
    dto: ReviewMarkDto,
  ): Promise<ReviewMarkModel> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const resolvedStudents = alias(students, 'resolved_students');
      const [row] = await tx
        .select({
          markId: sheetScanMarks.id,
          scanId: sheetScanMarks.scanId,
          fieldId: sheetScanMarks.fieldId,
          printedNumber: sheetScanMarks.printedNumber,
          state: sheetScanMarks.state,
          value: sheetScanMarks.value,
          fill: sheetScanMarks.fill,
          threshold: sheetScanMarks.threshold,
          margin: sheetScanMarks.margin,
          cropFileId: sheetScanMarks.cropFileId,
          batchId: sheetScans.batchId,
          batchStatus: sheetScanBatches.status,
          scanState: sheetScans.state,
          spec: sheetLayouts.spec,
          sheetFirstName: students.firstName,
          sheetLastName: students.lastName,
          resolvedFirstName: resolvedStudents.firstName,
          resolvedLastName: resolvedStudents.lastName,
        })
        .from(sheetScanMarks)
        .innerJoin(sheetScans, eq(sheetScans.id, sheetScanMarks.scanId))
        .innerJoin(sheetScanBatches, eq(sheetScanBatches.id, sheetScans.batchId))
        .innerJoin(sheetPrintRuns, eq(sheetPrintRuns.id, sheetScanBatches.printRunId))
        .innerJoin(sheetLayouts, eq(sheetLayouts.id, sheetPrintRuns.layoutId))
        .leftJoin(printedSheets, eq(printedSheets.id, sheetScans.printedSheetId))
        .leftJoin(students, eq(students.id, printedSheets.studentId))
        .leftJoin(resolvedStudents, eq(resolvedStudents.id, sheetScans.resolvedStudentId))
        .where(and(eq(sheetScanMarks.orgId, orgId), eq(sheetScanMarks.id, markId)))
        .limit(1);
      if (!row) throw new NotFoundException('Marca no encontrada');
      this.assertBatchInReview(row.batchStatus);
      if (row.scanState === 'superseded') {
        throw new ConflictException(
          'Esta marca pertenece a un escaneo reemplazado o descartado: revisa la versión vigente de la hoja.',
        );
      }

      const options = this.buildOptionsIndex(row.spec).get(row.fieldId) ?? [];
      if (dto.reviewedValue !== null && !options.includes(dto.reviewedValue)) {
        throw new BadRequestException(
          `"${dto.reviewedValue}" no es una alternativa válida para la pregunta ${row.printedNumber}. Alternativas: ${options.join(', ')}`,
        );
      }

      await tx
        .update(sheetScanMarks)
        .set({ reviewedValue: dto.reviewedValue, reviewedById: userId, reviewedAt: new Date() })
        .where(eq(sheetScanMarks.id, markId));

      await this.recountReviewPending(tx, orgId, row.batchId);

      const cropUrl = row.cropFileId
        ? ((await this.buildFileUrlIndex(tx, orgId, [row.cropFileId])).get(row.cropFileId) ?? null)
        : null;
      const studentName =
        this.fullName(row.resolvedFirstName, row.resolvedLastName) ??
        this.fullName(row.sheetFirstName, row.sheetLastName);

      return {
        markId: row.markId,
        scanId: row.scanId,
        studentName,
        printedNumber: row.printedNumber,
        state: row.state,
        value: row.value,
        fill: Number(row.fill),
        threshold: Number(row.threshold),
        margin: Number(row.margin),
        cropUrl,
        options,
        reviewedValue: dto.reviewedValue,
        reviewedById: userId,
      };
    });
  }

  async assignIdentity(
    orgId: string,
    userId: string,
    scanId: string,
    dto: AssignScanIdentityDto,
  ): Promise<ReviewScanModel> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const row = await this.selectScanForReview(tx, orgId, scanId);
      this.assertBatchInReview(row.batchStatus);
      if (row.state !== 'identity_unresolved' && row.state !== 'read') {
        throw new BadRequestException(
          'Sólo se puede asignar identidad a un escaneo leído o con identidad sin resolver',
        );
      }

      const [student] = await tx
        .select({
          id: students.id,
          firstName: students.firstName,
          lastName: students.lastName,
        })
        .from(students)
        .where(
          and(
            eq(students.orgId, orgId),
            eq(students.id, dto.studentId),
            isNull(students.deletedAt),
          ),
        )
        .limit(1);
      if (!student) throw new NotFoundException('Alumno no encontrado en tu organización');

      const nextState: SheetScanState = row.state === 'identity_unresolved' ? 'read' : row.state;
      const evidence: Record<string, unknown> = {
        ...(row.identityEvidence ?? {}),
        asignadoPor: userId,
        motivo: 'manual',
        candidatoPrevio: row.resolvedStudentId,
      };

      await tx
        .update(sheetScans)
        .set({
          resolvedStudentId: dto.studentId,
          identityConfidence: '1.000',
          identityEvidence: evidence,
          state: nextState,
        })
        .where(eq(sheetScans.id, scanId));

      await this.recountReviewPending(tx, orgId, row.batchId);

      const thumbUrl = row.thumbFileId
        ? ((await this.buildFileUrlIndex(tx, orgId, [row.thumbFileId])).get(row.thumbFileId) ??
          null)
        : null;

      return {
        scanId,
        state: nextState,
        rejectReason: row.quality.rejectReason ?? null,
        sheetSequence: row.sheetSequence,
        pageIndex: row.pageIndex,
        studentId: student.id,
        studentName: this.fullName(student.firstName, student.lastName),
        identityConfidence: 1,
        thumbUrl,
      };
    });
  }

  async discardScan(
    orgId: string,
    userId: string,
    scanId: string,
    dto: DiscardScanDto,
  ): Promise<ReviewScanModel> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const row = await this.selectScanForReview(tx, orgId, scanId);
      this.assertBatchInReview(row.batchStatus);
      if (row.state === 'superseded') {
        throw new ConflictException('El escaneo ya fue descartado o reemplazado');
      }

      const evidence: Record<string, unknown> = {
        ...(row.identityEvidence ?? {}),
        descartadoPor: userId,
        razon: dto.reason,
      };

      await tx
        .update(sheetScans)
        .set({ state: 'superseded', identityEvidence: evidence })
        .where(eq(sheetScans.id, scanId));

      await this.recountReviewPending(tx, orgId, row.batchId);

      const thumbUrl = row.thumbFileId
        ? ((await this.buildFileUrlIndex(tx, orgId, [row.thumbFileId])).get(row.thumbFileId) ??
          null)
        : null;

      return {
        scanId,
        state: 'superseded',
        rejectReason: row.quality.rejectReason ?? null,
        sheetSequence: row.sheetSequence,
        pageIndex: row.pageIndex,
        studentId: row.resolvedStudentId ?? row.sheetStudentId,
        studentName:
          this.fullName(row.resolvedFirstName, row.resolvedLastName) ??
          this.fullName(row.sheetFirstName, row.sheetLastName),
        identityConfidence: row.identityConfidence !== null ? Number(row.identityConfidence) : null,
        thumbUrl,
      };
    });
  }

  async confirmBatch(
    orgId: string,
    user: JwtPayload,
    batchId: string,
  ): Promise<ConfirmBatchResponse> {
    const prepared = await withOrgContext(this.db, orgId, async (tx) => {
      const [batch] = await tx
        .select({
          id: sheetScanBatches.id,
          status: sheetScanBatches.status,
          assessmentId: sheetPrintRuns.assessmentId,
          classGroupId: sheetPrintRuns.classGroupId,
          instrumentId: sheetLayouts.instrumentId,
          spec: sheetLayouts.spec,
        })
        .from(sheetScanBatches)
        .innerJoin(sheetPrintRuns, eq(sheetPrintRuns.id, sheetScanBatches.printRunId))
        .innerJoin(sheetLayouts, eq(sheetLayouts.id, sheetPrintRuns.layoutId))
        .where(and(eq(sheetScanBatches.orgId, orgId), eq(sheetScanBatches.id, batchId)))
        .limit(1);
      if (!batch) throw new NotFoundException('Lote de escaneo no encontrado');
      if (batch.status !== 'needs_review') {
        throw new ConflictException(
          `Sólo un lote en revisión puede confirmarse (estado actual: ${batch.status})`,
        );
      }
      if (!batch.assessmentId) {
        throw new BadRequestException(
          'La tirada de este lote no tiene una evaluación asociada. Asóciala desde el aviso de esta misma pantalla (o en Hojas de respuesta → la tirada) y vuelve a confirmar.',
        );
      }

      const scanRows = await tx
        .select({
          scanId: sheetScans.id,
          printedSheetId: sheetScans.printedSheetId,
          pageIndex: sheetScans.pageIndex,
          state: sheetScans.state,
          resolvedStudentId: sheetScans.resolvedStudentId,
          sheetStudentId: printedSheets.studentId,
          sheetSequence: printedSheets.sequence,
        })
        .from(sheetScans)
        .innerJoin(printedSheets, eq(printedSheets.id, sheetScans.printedSheetId))
        .where(
          and(
            eq(sheetScans.orgId, orgId),
            eq(sheetScans.batchId, batchId),
            ne(sheetScans.state, 'superseded'),
            isNotNull(sheetScans.printedSheetId),
          ),
        );

      const markRows: ConfirmMarkRow[] = await tx
        .select({
          markId: sheetScanMarks.id,
          scanId: sheetScanMarks.scanId,
          printedNumber: sheetScanMarks.printedNumber,
          state: sheetScanMarks.state,
          value: sheetScanMarks.value,
          reviewedValue: sheetScanMarks.reviewedValue,
          reviewedAt: sheetScanMarks.reviewedAt,
        })
        .from(sheetScanMarks)
        .innerJoin(sheetScans, eq(sheetScans.id, sheetScanMarks.scanId))
        .where(
          and(
            eq(sheetScanMarks.orgId, orgId),
            eq(sheetScans.batchId, batchId),
            ne(sheetScans.state, 'superseded'),
          ),
        );

      const marksByScanId = new Map<string, ConfirmMarkRow[]>();
      for (const mark of markRows) {
        const bucket = marksByScanId.get(mark.scanId);
        if (bucket) bucket.push(mark);
        else marksByScanId.set(mark.scanId, [mark]);
      }

      const sheets = new Map<string, SheetGroup>();
      for (const scan of scanRows) {
        if (scan.state === 'quality_rejected' || !scan.printedSheetId) continue;
        let sheet = sheets.get(scan.printedSheetId);
        if (!sheet) {
          sheet = {
            sequence: scan.sheetSequence,
            studentId: null,
            pages: new Set<number>(),
            marks: [],
          };
          sheets.set(scan.printedSheetId, sheet);
        }
        sheet.studentId = sheet.studentId ?? scan.resolvedStudentId ?? scan.sheetStudentId;
        sheet.pages.add(scan.pageIndex);
        const scanMarks = marksByScanId.get(scan.scanId);
        if (scanMarks) sheet.marks.push(...scanMarks);
      }

      const studentIds: string[] = [];
      for (const sheet of sheets.values()) {
        if (sheet.studentId) studentIds.push(sheet.studentId);
      }
      const studentRows =
        studentIds.length > 0
          ? await tx
              .select({
                id: students.id,
                rut: students.rut,
                firstName: students.firstName,
                lastName: students.lastName,
              })
              .from(students)
              .where(
                and(
                  eq(students.orgId, orgId),
                  isNull(students.deletedAt),
                  inArray(students.id, studentIds),
                ),
              )
          : [];
      const studentById = new Map(studentRows.map((s) => [s.id, s]));

      return { batch: { ...batch, assessmentId: batch.assessmentId }, sheets, studentById };
    });

    const pageCount = prepared.batch.spec.pageCount;
    const confirmedScans: ConfirmedScanInput[] = [];
    let incompleteSheets = 0;
    let unidentifiedSheets = 0;
    let assumedPending = 0;

    for (const sheet of prepared.sheets.values()) {
      const student = sheet.studentId ? prepared.studentById.get(sheet.studentId) : undefined;
      if (!student) {
        unidentifiedSheets++;
        continue;
      }
      if (sheet.pages.size < pageCount) {
        incompleteSheets++;
        continue;
      }
      const marks = sheet.marks.map((mark) => {
        const reviewed = mark.reviewedAt !== null;
        if (!reviewed && (mark.state === 'multiple' || mark.state === 'ambiguous')) {
          assumedPending++;
        }
        return {
          printedNumber: mark.printedNumber,
          state: mark.state,
          value: mark.value,
          ...(reviewed ? { reviewedValue: mark.reviewedValue } : {}),
        };
      });
      confirmedScans.push({
        sequence: sheet.sequence,
        studentRut: student.rut,
        studentFullName: this.fullName(student.firstName, student.lastName),
        marks,
      });
    }

    if (confirmedScans.length === 0) {
      throw new BadRequestException(
        `El lote no tiene hojas completas e identificadas para confirmar (incompletas: ${incompleteSheets}, sin identidad: ${unidentifiedSheets})`,
      );
    }

    confirmedScans.sort((a, b) => a.sequence - b.sequence);
    const parserResult = toParserResult(confirmedScans);

    const claimed = await withOrgContext(this.db, orgId, (tx) =>
      tx
        .update(sheetScanBatches)
        .set({ status: 'confirmed', updatedAt: new Date() })
        .where(
          and(
            eq(sheetScanBatches.orgId, orgId),
            eq(sheetScanBatches.id, batchId),
            eq(sheetScanBatches.status, 'needs_review'),
          ),
        )
        .returning({ id: sheetScanBatches.id }),
    );
    if (claimed.length === 0) {
      throw new ConflictException('El lote ya fue confirmado por otra persona.');
    }

    let outcome: AnswerSheetConfirmOutcome;
    try {
      outcome = await this.answerSheetConfirmer.confirmParserResult(user, {
        orgId,
        instrumentId: prepared.batch.instrumentId,
        classGroupId: prepared.batch.classGroupId,
        assessmentId: prepared.batch.assessmentId,
        parserResult,
      });
    } catch (error) {
      await withOrgContext(this.db, orgId, (tx) =>
        tx
          .update(sheetScanBatches)
          .set({ status: 'needs_review', updatedAt: new Date() })
          .where(and(eq(sheetScanBatches.orgId, orgId), eq(sheetScanBatches.id, batchId))),
      );
      throw error;
    }

    await withOrgContext(this.db, orgId, async (tx) => {
      await tx
        .update(sheetScanBatches)
        .set({ importJobId: outcome.jobId, updatedAt: new Date() })
        .where(and(eq(sheetScanBatches.orgId, orgId), eq(sheetScanBatches.id, batchId)));
    });

    return {
      batchId,
      status: 'confirmed',
      importJobId: outcome.jobId,
      summary: {
        sheetsPersisted: confirmedScans.length,
        responsesPersisted: outcome.responsesCreated,
        assumedPending,
      },
    };
  }

  private async selectBatchScans(
    tx: Database,
    orgId: string,
    batchId: string,
  ): Promise<ScanQueueRow[]> {
    const resolvedStudents = alias(students, 'resolved_students');
    return tx
      .select({
        scanId: sheetScans.id,
        state: sheetScans.state,
        quality: sheetScans.quality,
        pageIndex: sheetScans.pageIndex,
        sheetSequence: printedSheets.sequence,
        sheetStudentId: printedSheets.studentId,
        resolvedStudentId: sheetScans.resolvedStudentId,
        identityConfidence: sheetScans.identityConfidence,
        thumbFileId: sheetScans.thumbFileId,
        sheetFirstName: students.firstName,
        sheetLastName: students.lastName,
        resolvedFirstName: resolvedStudents.firstName,
        resolvedLastName: resolvedStudents.lastName,
      })
      .from(sheetScans)
      .leftJoin(printedSheets, eq(printedSheets.id, sheetScans.printedSheetId))
      .leftJoin(students, eq(students.id, printedSheets.studentId))
      .leftJoin(resolvedStudents, eq(resolvedStudents.id, sheetScans.resolvedStudentId))
      .where(and(eq(sheetScans.orgId, orgId), eq(sheetScans.batchId, batchId)));
  }

  private async selectPendingMarks(
    tx: Database,
    orgId: string,
    batchId: string,
  ): Promise<MarkQueueRow[]> {
    return tx
      .select({
        markId: sheetScanMarks.id,
        scanId: sheetScanMarks.scanId,
        fieldId: sheetScanMarks.fieldId,
        printedNumber: sheetScanMarks.printedNumber,
        state: sheetScanMarks.state,
        value: sheetScanMarks.value,
        fill: sheetScanMarks.fill,
        threshold: sheetScanMarks.threshold,
        margin: sheetScanMarks.margin,
        cropFileId: sheetScanMarks.cropFileId,
        reviewedValue: sheetScanMarks.reviewedValue,
        reviewedById: sheetScanMarks.reviewedById,
      })
      .from(sheetScanMarks)
      .innerJoin(sheetScans, eq(sheetScans.id, sheetScanMarks.scanId))
      .where(
        and(
          eq(sheetScanMarks.orgId, orgId),
          eq(sheetScans.batchId, batchId),
          ne(sheetScans.state, 'superseded'),
          inArray(sheetScanMarks.state, PENDING_MARK_STATES),
          isNull(sheetScanMarks.reviewedAt),
        ),
      );
  }

  private async selectScanForReview(tx: Database, orgId: string, scanId: string) {
    const resolvedStudents = alias(students, 'resolved_students');
    const [row] = await tx
      .select({
        scanId: sheetScans.id,
        state: sheetScans.state,
        quality: sheetScans.quality,
        pageIndex: sheetScans.pageIndex,
        batchId: sheetScans.batchId,
        batchStatus: sheetScanBatches.status,
        resolvedStudentId: sheetScans.resolvedStudentId,
        identityConfidence: sheetScans.identityConfidence,
        identityEvidence: sheetScans.identityEvidence,
        thumbFileId: sheetScans.thumbFileId,
        sheetSequence: printedSheets.sequence,
        sheetStudentId: printedSheets.studentId,
        sheetFirstName: students.firstName,
        sheetLastName: students.lastName,
        resolvedFirstName: resolvedStudents.firstName,
        resolvedLastName: resolvedStudents.lastName,
      })
      .from(sheetScans)
      .innerJoin(sheetScanBatches, eq(sheetScanBatches.id, sheetScans.batchId))
      .leftJoin(printedSheets, eq(printedSheets.id, sheetScans.printedSheetId))
      .leftJoin(students, eq(students.id, printedSheets.studentId))
      .leftJoin(resolvedStudents, eq(resolvedStudents.id, sheetScans.resolvedStudentId))
      .where(and(eq(sheetScans.orgId, orgId), eq(sheetScans.id, scanId)))
      .limit(1);
    if (!row) throw new NotFoundException('Escaneo no encontrado');
    return row;
  }

  private assertBatchInReview(status: string): void {
    if (status !== 'needs_review') {
      throw new ConflictException(
        `El lote no está en revisión (estado actual: ${status}) — no admite correcciones`,
      );
    }
  }

  private async recountReviewPending(
    tx: Database,
    orgId: string,
    batchId: string,
  ): Promise<number> {
    const [scanCount] = await tx
      .select({ total: sql<number>`count(*)` })
      .from(sheetScans)
      .where(
        and(
          eq(sheetScans.orgId, orgId),
          eq(sheetScans.batchId, batchId),
          inArray(sheetScans.state, PENDING_SCAN_STATES),
        ),
      );
    const [markCount] = await tx
      .select({ total: sql<number>`count(*)` })
      .from(sheetScanMarks)
      .innerJoin(sheetScans, eq(sheetScans.id, sheetScanMarks.scanId))
      .where(
        and(
          eq(sheetScanMarks.orgId, orgId),
          eq(sheetScans.batchId, batchId),
          ne(sheetScans.state, 'superseded'),
          inArray(sheetScanMarks.state, PENDING_MARK_STATES),
          isNull(sheetScanMarks.reviewedAt),
        ),
      );

    const pending = Number(scanCount?.total ?? 0) + Number(markCount?.total ?? 0);
    await tx
      .update(sheetScanBatches)
      .set({ reviewPending: pending, updatedAt: new Date() })
      .where(and(eq(sheetScanBatches.orgId, orgId), eq(sheetScanBatches.id, batchId)));
    return pending;
  }

  private async buildFileUrlIndex(
    tx: Database,
    orgId: string,
    fileIds: string[],
  ): Promise<Map<string, string | null>> {
    if (fileIds.length === 0) return new Map();
    const uniqueIds = Array.from(new Set(fileIds));
    const rows: FileRecord[] = await tx
      .select()
      .from(files)
      .where(and(eq(files.orgId, orgId), inArray(files.id, uniqueIds)));
    const index = new Map<string, string | null>();
    for (const row of rows) {
      index.set(row.id, this.filesService.buildDownloadUrl(row, 'inline') ?? null);
    }
    return index;
  }

  private buildOptionsIndex(spec: LayoutSpec): Map<string, string[]> {
    const index = new Map<string, string[]>();
    for (const field of spec.fields) {
      index.set(
        field.fieldId,
        field.bubbles.map((bubble) => bubble.value),
      );
    }
    return index;
  }

  private toReviewScanModel(
    scan: ScanQueueRow,
    urlByFileId: Map<string, string | null>,
  ): ReviewScanModel {
    return {
      scanId: scan.scanId,
      state: scan.state,
      rejectReason: scan.quality.rejectReason ?? null,
      sheetSequence: scan.sheetSequence,
      pageIndex: scan.pageIndex,
      studentId: scan.resolvedStudentId ?? scan.sheetStudentId,
      studentName: this.studentNameOf(scan),
      identityConfidence: scan.identityConfidence !== null ? Number(scan.identityConfidence) : null,
      thumbUrl: scan.thumbFileId ? (urlByFileId.get(scan.thumbFileId) ?? null) : null,
    };
  }

  private toReviewMarkModel(
    mark: MarkQueueRow,
    studentName: string | null,
    options: string[],
    cropUrl: string | null,
  ): ReviewMarkModel {
    return {
      markId: mark.markId,
      scanId: mark.scanId,
      studentName,
      printedNumber: mark.printedNumber,
      state: mark.state,
      value: mark.value,
      fill: Number(mark.fill),
      threshold: Number(mark.threshold),
      margin: Number(mark.margin),
      cropUrl,
      options,
      reviewedValue: mark.reviewedValue,
      reviewedById: mark.reviewedById,
    };
  }

  private studentNameOf(scan: ScanQueueRow): string | null {
    return (
      this.fullName(scan.resolvedFirstName, scan.resolvedLastName) ??
      this.fullName(scan.sheetFirstName, scan.sheetLastName)
    );
  }

  private fullName(firstName: string | null, lastName: string | null): string | null {
    const name = `${firstName ?? ''} ${lastName ?? ''}`.trim();
    return name.length > 0 ? name : null;
  }
}
