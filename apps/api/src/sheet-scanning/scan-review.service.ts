import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNull, isNotNull, ne, notInArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  files,
  printedSheets,
  sheetLayouts,
  sheetPrintRuns,
  organizations,
  sheetScanBatches,
  sheetScanMarks,
  sheetScans,
  students,
  withOrgContext,
  type FileRecord,
} from '@soe/db';
import type {
  AssignScanIdentityDto,
  BatchCorrectionsModel,
  ConfirmBatchResponse,
  DiscardScanDto,
  LayoutSpec,
  DoubtReason,
  MarkAiResolution,
  MarkReviewDecision,
  MarkState,
  PageQuality,
  ReviewMarkAiResolutionModel,
  ReviewMarkDto,
  ReviewMarkModel,
  ReviewQueueModel,
  ReviewScanModel,
  SheetScanState,
  RubricEngine,
} from '@soe/types';
import { autoAnnulMinConfidence, isQuickConfirmEnabled } from '@soe/types';
import {
  AnswerReadingConsolidationService,
  type ConfirmedCropMark,
  type ConfirmedReadingLink,
  type ConfirmedReadingsInput,
  type ReadingConfirmation,
} from '../answer-reading/answer-reading-consolidation.service';
import { RubricGradingService } from '../answer-reading/rubric-grading.service';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { reportServerError } from '../common/observability/report-error';
import { InjectDb, type Database } from '../database/database.types';
import type {
  AnswerSheetsService,
  RescoreScannedAnswerInput,
  RescoreWithinTransaction,
} from '../answer-sheets/answer-sheets.service';
import type { AssessmentResultsService } from '../assessment-results/assessment-results.service';
import type { AnswerSheetPreviewStore } from '../answer-sheets/lib/preview-store';
import type { ParserResult } from '../answer-sheets/lib/parsers/parser.types';
import { FilesService } from '../files/files.service';
import {
  DevelopmentGradingService,
  type ScheduleConfirmedBatchParams,
} from './development-grading.service';
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
  rescoreScannedAnswer(
    orgId: string,
    input: RescoreScannedAnswerInput,
    withinTransaction?: RescoreWithinTransaction,
  ): Promise<void>;
}

export function createAnswerSheetConfirmer(
  answerSheets: AnswerSheetsService,
  previewStore: AnswerSheetPreviewStore,
  results: AssessmentResultsService,
): AnswerSheetConfirmer {
  return {
    async rescoreScannedAnswer(orgId, input, withinTransaction) {
      await answerSheets.rescoreScannedAnswer(orgId, input, withinTransaction);
      await results.recalculateAnswerSheetResults(orgId, [input.assessmentId]);
    },
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
  sourceFileId: string | null;
  sourcePageIndex: number | null;
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
  suggestedValue: string | null;
  doubtReason: DoubtReason | null;
  nullConfidence: string | null;
  reviewedValue: string | null;
  reviewDecision: MarkReviewDecision | null;
  reviewedById: string | null;
  autoResolved: boolean;
  aiResolution: MarkAiResolution | null;
};

type ConfirmMarkRow = {
  markId: string;
  scanId: string;
  printedNumber: string;
  state: MarkState;
  value: string | null;
  reviewedValue: string | null;
  reviewDecision: MarkReviewDecision | null;
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
    private readonly developmentGrading: DevelopmentGradingService,
    private readonly readingConsolidation: AnswerReadingConsolidationService,
    private readonly rubricGrading: RubricGradingService,
  ) {}

  async getQueue(orgId: string, batchId: string): Promise<ReviewQueueModel> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const [batch] = await tx
        .select({
          id: sheetScanBatches.id,
          spec: sheetLayouts.spec,
          orgConfig: organizations.config,
        })
        .from(sheetScanBatches)
        .innerJoin(sheetPrintRuns, eq(sheetPrintRuns.id, sheetScanBatches.printRunId))
        .innerJoin(sheetLayouts, eq(sheetLayouts.id, sheetPrintRuns.layoutId))
        .innerJoin(organizations, eq(organizations.id, sheetScanBatches.orgId))
        .where(and(eq(sheetScanBatches.orgId, orgId), eq(sheetScanBatches.id, batchId)))
        .limit(1);
      if (!batch) throw new NotFoundException('Lote de escaneo no encontrado');

      const scanRows = await this.selectBatchScans(tx, orgId, batchId);
      const markRows = await this.selectPendingMarks(tx, orgId, batchId, 'pending');

      const fileIds: string[] = [];
      for (const scan of scanRows) {
        if (!PENDING_SCAN_STATES.includes(scan.state)) continue;
        if (scan.thumbFileId) fileIds.push(scan.thumbFileId);
        // La hoja original: es lo único que sirve para leer un nombre escrito a
        // mano, y una hoja de RESERVA llega acá sin thumb (el motor sólo lo genera
        // si la calidad falla o el QR es ilegible, y una reserva tiene los dos
        // bien).
        if (scan.sourceFileId) fileIds.push(scan.sourceFileId);
      }
      for (const mark of markRows) {
        if (mark.cropFileId) fileIds.push(mark.cropFileId);
      }
      const fileIndex = await this.buildFileIndex(tx, orgId, fileIds);
      const urlByFileId = new Map([...fileIndex].map(([id, f]) => [id, f.url]));

      const scanById = new Map<string, ScanQueueRow>();
      const qualityRejected: ReviewScanModel[] = [];
      const identityUnresolved: ReviewScanModel[] = [];
      for (const scan of scanRows) {
        scanById.set(scan.scanId, scan);
        if (scan.state === 'quality_rejected') {
          qualityRejected.push(this.toReviewScanModel(scan, urlByFileId, fileIndex));
        } else if (scan.state === 'identity_unresolved') {
          identityUnresolved.push(this.toReviewScanModel(scan, urlByFileId, fileIndex));
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

      const autoRows = await this.selectPendingMarks(tx, orgId, batchId, 'auto');
      const autoUrlByFileId = await this.buildFileUrlIndex(
        tx,
        orgId,
        autoRows.flatMap((mark) => (mark.cropFileId ? [mark.cropFileId] : [])),
      );
      const autoAnnulled = autoRows.map((mark) => {
        const scan = scanById.get(mark.scanId);
        return this.toReviewMarkModel(
          mark,
          scan ? this.studentNameOf(scan) : null,
          optionsByFieldId.get(mark.fieldId) ?? [],
          mark.cropFileId ? (autoUrlByFileId.get(mark.cropFileId) ?? null) : null,
        );
      });

      return {
        batchId,
        qualityRejected,
        identityUnresolved,
        ambiguousMarks,
        autoAnnulled,
        settings: {
          quickConfirm: isQuickConfirmEnabled(batch.orgConfig),
          autoAnnulMinConfidence: autoAnnulMinConfidence(batch.orgConfig),
        },
      };
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
          suggestedValue: sheetScanMarks.suggestedValue,
          doubtReason: sheetScanMarks.doubtReason,
          nullConfidence: sheetScanMarks.nullConfidence,
          aiResolution: sheetScanMarks.aiResolution,
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
      const reviewedValue = this.reviewedValueFor(dto, row.suggestedValue, row.printedNumber);
      const reviewDecision: MarkReviewDecision =
        dto.decision === 'confirm' ? 'option' : dto.decision;
      if (reviewedValue !== null && !options.includes(reviewedValue)) {
        throw new BadRequestException(
          `"${reviewedValue}" no es una alternativa válida para la pregunta ${row.printedNumber}. Alternativas: ${options.join(', ')}`,
        );
      }

      await tx
        .update(sheetScanMarks)
        .set({
          reviewedValue,
          reviewDecision,
          reviewedById: userId,
          reviewedAt: new Date(),
          autoResolved: false,
        })
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
        suggestedValue: row.suggestedValue,
        doubtReason: row.doubtReason,
        nullConfidence: this.decimalOrNull(row.nullConfidence),
        reviewedValue,
        reviewedDecision: reviewDecision,
        reviewedById: userId,
        autoResolved: false,
        aiResolution: this.teacherAiResolution(row.aiResolution),
      };
    });
  }

  async getCorrections(orgId: string, batchId: string): Promise<BatchCorrectionsModel> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const [batch] = await tx
        .select({ status: sheetScanBatches.status, spec: sheetLayouts.spec })
        .from(sheetScanBatches)
        .innerJoin(sheetPrintRuns, eq(sheetPrintRuns.id, sheetScanBatches.printRunId))
        .innerJoin(sheetLayouts, eq(sheetLayouts.id, sheetPrintRuns.layoutId))
        .where(and(eq(sheetScanBatches.orgId, orgId), eq(sheetScanBatches.id, batchId)))
        .limit(1);
      if (!batch) throw new NotFoundException('Lote de escaneo no encontrado');
      this.assertBatchConfirmed(batch.status);

      const scanRows = await this.selectBatchScans(tx, orgId, batchId);
      const scanById = new Map(scanRows.map((scan) => [scan.scanId, scan]));
      const markRows = await this.selectPendingMarks(tx, orgId, batchId, 'all');
      const urlByFileId = await this.buildFileUrlIndex(
        tx,
        orgId,
        markRows.flatMap((mark) => (mark.cropFileId ? [mark.cropFileId] : [])),
      );
      const optionsByFieldId = this.buildOptionsIndex(batch.spec);
      const marks = markRows.map((mark) => {
        const scan = scanById.get(mark.scanId);
        return this.toReviewMarkModel(
          mark,
          scan ? this.studentNameOf(scan) : null,
          optionsByFieldId.get(mark.fieldId) ?? [],
          mark.cropFileId ? (urlByFileId.get(mark.cropFileId) ?? null) : null,
        );
      });
      return { batchId, marks };
    });
  }

  async correctConfirmedMark(
    orgId: string,
    userId: string,
    markId: string,
    dto: ReviewMarkDto,
  ): Promise<ReviewMarkModel> {
    const prepared = await withOrgContext(this.db, orgId, async (tx) => {
      const resolvedStudents = alias(students, 'resolved_students');
      const [row] = await tx
        .select({
          mark: sheetScanMarks,
          sheetFirstName: students.firstName,
          sheetLastName: students.lastName,
          resolvedFirstName: resolvedStudents.firstName,
          resolvedLastName: resolvedStudents.lastName,
          batchId: sheetScans.batchId,
          batchStatus: sheetScanBatches.status,
          scanState: sheetScans.state,
          printedSheetId: sheetScans.printedSheetId,
          resolvedStudentId: sheetScans.resolvedStudentId,
          sheetStudentId: printedSheets.studentId,
          assessmentId: sheetPrintRuns.assessmentId,
          instrumentId: sheetLayouts.instrumentId,
          spec: sheetLayouts.spec,
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
      this.assertBatchConfirmed(row.batchStatus);
      if (row.scanState === 'superseded' || row.scanState === 'quality_rejected') {
        throw new ConflictException(
          'Esta marca pertenece a un escaneo que no entró a los resultados: no hay respuesta que corregir.',
        );
      }
      const studentId = row.resolvedStudentId ?? row.sheetStudentId;
      if (!row.assessmentId || !row.printedSheetId || !studentId) {
        throw new ConflictException(
          'La hoja de esta marca no quedó asociada a un alumno y una evaluación al confirmar el lote.',
        );
      }
      const field = row.spec.fields.find((candidate) => candidate.fieldId === row.mark.fieldId);
      if (!field || field.kind !== 'bubble_group') {
        throw new BadRequestException(
          `La pregunta ${row.mark.printedNumber} no es de alternativas: corrígela desde su propia revisión.`,
        );
      }
      const options = field.bubbles.map((bubble) => bubble.value);
      const reviewedValue = this.reviewedValueFor(
        dto,
        row.mark.suggestedValue,
        row.mark.printedNumber,
      );
      const reviewDecision: MarkReviewDecision =
        dto.decision === 'confirm' ? 'option' : dto.decision;
      if (reviewedValue !== null && !options.includes(reviewedValue)) {
        throw new BadRequestException(
          `"${reviewedValue}" no es una alternativa válida para la pregunta ${row.mark.printedNumber}. Alternativas: ${options.join(', ')}`,
        );
      }

      const sheetMarks = await tx
        .select({
          markId: sheetScanMarks.id,
          fieldId: sheetScanMarks.fieldId,
          printedNumber: sheetScanMarks.printedNumber,
          state: sheetScanMarks.state,
          value: sheetScanMarks.value,
          reviewedValue: sheetScanMarks.reviewedValue,
          reviewDecision: sheetScanMarks.reviewDecision,
          reviewedAt: sheetScanMarks.reviewedAt,
        })
        .from(sheetScanMarks)
        .innerJoin(sheetScans, eq(sheetScans.id, sheetScanMarks.scanId))
        .where(
          and(
            eq(sheetScanMarks.orgId, orgId),
            eq(sheetScans.batchId, row.batchId),
            eq(sheetScans.printedSheetId, row.printedSheetId),
            notInArray(sheetScans.state, ['superseded', 'quality_rejected']),
          ),
        );
      const pagesRead = await tx
        .selectDistinct({ pageIndex: sheetScans.pageIndex })
        .from(sheetScans)
        .where(
          and(
            eq(sheetScans.orgId, orgId),
            eq(sheetScans.batchId, row.batchId),
            eq(sheetScans.printedSheetId, row.printedSheetId),
            notInArray(sheetScans.state, ['superseded', 'quality_rejected']),
          ),
        );
      if (pagesRead.length < row.spec.pageCount) {
        throw new ConflictException(
          'La hoja de esta marca quedó incompleta al confirmar el lote: sus respuestas no entraron a los resultados.',
        );
      }

      const bubbleFieldIds = new Set(
        row.spec.fields.filter((f) => f.kind === 'bubble_group').map((f) => f.fieldId),
      );
      const answers: Record<string, string | null> = {};
      const annulledLabels: string[] = [];
      for (const mark of sheetMarks) {
        if (!bubbleFieldIds.has(mark.fieldId)) continue;
        const corrected = mark.markId === markId;
        const decision = corrected ? reviewDecision : mark.reviewDecision;
        const reviewed = corrected || mark.reviewedAt !== null;
        if (reviewed) {
          answers[mark.printedNumber] = corrected ? reviewedValue : mark.reviewedValue;
          if (decision === 'annulled') annulledLabels.push(mark.printedNumber);
          continue;
        }
        answers[mark.printedNumber] = mark.state === 'marked' ? mark.value : null;
      }

      return {
        row,
        studentId,
        assessmentId: row.assessmentId,
        options,
        reviewedValue,
        reviewDecision,
        rescore: {
          assessmentId: row.assessmentId,
          instrumentId: row.instrumentId,
          studentId,
          label: row.mark.printedNumber,
          answers,
          annulledLabels,
        },
      };
    });

    await this.answerSheetConfirmer.rescoreScannedAnswer(orgId, prepared.rescore, async (tx) => {
      await tx
        .update(sheetScanMarks)
        .set({
          reviewedValue: prepared.reviewedValue,
          reviewDecision: prepared.reviewDecision,
          reviewedById: userId,
          reviewedAt: new Date(),
          autoResolved: false,
        })
        .where(and(eq(sheetScanMarks.id, markId), eq(sheetScanMarks.orgId, orgId)));
    });

    return withOrgContext(this.db, orgId, async (tx) => {
      const mark = prepared.row.mark;
      const cropUrl = mark.cropFileId
        ? ((await this.buildFileUrlIndex(tx, orgId, [mark.cropFileId])).get(mark.cropFileId) ??
          null)
        : null;
      return this.toReviewMarkModel(
        {
          markId: mark.id,
          scanId: mark.scanId,
          fieldId: mark.fieldId,
          printedNumber: mark.printedNumber,
          state: mark.state,
          value: mark.value,
          fill: mark.fill,
          threshold: mark.threshold,
          margin: mark.margin,
          cropFileId: mark.cropFileId,
          suggestedValue: mark.suggestedValue,
          doubtReason: mark.doubtReason,
          nullConfidence: mark.nullConfidence,
          reviewedValue: prepared.reviewedValue,
          reviewDecision: prepared.reviewDecision,
          reviewedById: userId,
          autoResolved: false,
          aiResolution: mark.aiResolution,
        },
        this.fullName(prepared.row.resolvedFirstName, prepared.row.resolvedLastName) ??
          this.fullName(prepared.row.sheetFirstName, prepared.row.sheetLastName),
        prepared.options,
        cropUrl,
      );
    });
  }

  private assertBatchConfirmed(status: string): void {
    if (status !== 'confirmed') {
      throw new ConflictException(
        `El lote todavía no está confirmado (estado actual: ${status}): corrige la marca desde la revisión del lote.`,
      );
    }
  }

  private reviewedValueFor(
    dto: ReviewMarkDto,
    suggestedValue: string | null,
    printedNumber: string,
  ): string | null {
    if (dto.decision === 'option') return dto.reviewedValue;
    if (dto.decision !== 'confirm') return null;
    if (suggestedValue === null) {
      throw new BadRequestException(
        `La pregunta ${printedNumber} no tiene una alternativa sugerida para confirmar: elige una alternativa, en blanco o anulada.`,
      );
    }
    return suggestedValue;
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

      // El mismo índice resuelve thumb y hoja original: la respuesta de esta
      // acción alimenta la misma fila que la cola, así que tiene que traer lo
      // mismo o la imagen desaparecería al confirmar.
      const idx = await this.buildFileIndex(
        tx,
        orgId,
        [row.thumbFileId, row.sourceFileId].filter((x): x is string => x !== null),
      );
      const thumbUrl = row.thumbFileId ? (idx.get(row.thumbFileId)?.url ?? null) : null;
      const source = row.sourceFileId ? idx.get(row.sourceFileId) : undefined;

      return {
        scanId,
        state: nextState,
        rejectReason: row.quality.rejectReason ?? null,
        marksReadability: row.quality.marksReadability ?? null,
        sheetSequence: row.sheetSequence,
        pageIndex: row.pageIndex,
        studentId: student.id,
        studentName: this.fullName(student.firstName, student.lastName),
        identityConfidence: 1,
        thumbUrl,
        sourceUrl: source?.url ?? null,
        sourceContentType: source?.contentType ?? null,
        sourcePageIndex: row.sourcePageIndex,
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

      // El mismo índice resuelve thumb y hoja original: la respuesta de esta
      // acción alimenta la misma fila que la cola, así que tiene que traer lo
      // mismo o la imagen desaparecería al confirmar.
      const idx = await this.buildFileIndex(
        tx,
        orgId,
        [row.thumbFileId, row.sourceFileId].filter((x): x is string => x !== null),
      );
      const thumbUrl = row.thumbFileId ? (idx.get(row.thumbFileId)?.url ?? null) : null;
      const source = row.sourceFileId ? idx.get(row.sourceFileId) : undefined;

      return {
        scanId,
        state: 'superseded',
        rejectReason: row.quality.rejectReason ?? null,
        marksReadability: row.quality.marksReadability ?? null,
        sheetSequence: row.sheetSequence,
        pageIndex: row.pageIndex,
        studentId: row.resolvedStudentId ?? row.sheetStudentId,
        studentName:
          this.fullName(row.resolvedFirstName, row.resolvedLastName) ??
          this.fullName(row.sheetFirstName, row.sheetLastName),
        identityConfidence: row.identityConfidence !== null ? Number(row.identityConfidence) : null,
        thumbUrl,
        sourceUrl: source?.url ?? null,
        sourceContentType: source?.contentType ?? null,
        sourcePageIndex: row.sourcePageIndex,
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
          reviewDecision: sheetScanMarks.reviewDecision,
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
    const cropItemByPrintedNumber = this.cropItemsByPrintedNumber(prepared.batch.spec);
    const readings =
      cropItemByPrintedNumber.size > 0
        ? await this.readingConsolidation.readingsForConfirmation(orgId, batchId)
        : new Map<string, ReadingConfirmation>();
    const readingLinks: ConfirmedReadingLink[] = [];
    const confirmedCropMarks: ConfirmedCropMark[] = [];
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
      const marks: ConfirmedScanInput['marks'] = [];
      for (const mark of sheet.marks) {
        if (cropItemByPrintedNumber.has(mark.printedNumber)) {
          const reading = readings.get(mark.markId);
          confirmedCropMarks.push({
            markId: mark.markId,
            studentId: student.id,
            itemId: cropItemByPrintedNumber.get(mark.printedNumber) ?? null,
          });
          if (reading) {
            readingLinks.push({
              decisionId: reading.decisionId,
              studentId: student.id,
              itemId: reading.itemId,
              consolidated: reading.prescored !== null,
            });
          }
          marks.push(
            reading?.prescored
              ? {
                  printedNumber: mark.printedNumber,
                  state: mark.state,
                  value: null,
                  prescored: reading.prescored,
                }
              : {
                  printedNumber: mark.printedNumber,
                  state: mark.state,
                  value: null,
                  pendingReading: true,
                },
          );
          continue;
        }
        const reviewed = mark.reviewedAt !== null;
        if (!reviewed && (mark.state === 'multiple' || mark.state === 'ambiguous')) {
          assumedPending++;
        }
        marks.push({
          printedNumber: mark.printedNumber,
          state: mark.state,
          value: mark.value,
          ...(reviewed
            ? { reviewedValue: mark.reviewedValue, reviewDecision: mark.reviewDecision }
            : {}),
        });
      }
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

    await this.linkConfirmedReadings(orgId, batchId, {
      assessmentId: prepared.batch.assessmentId,
      links: readingLinks,
      cropMarks: confirmedCropMarks,
    });

    await this.scheduleDevelopmentGrading({
      orgId,
      batchId,
      assessmentId: prepared.batch.assessmentId,
      instrumentId: prepared.batch.instrumentId,
      spec: prepared.batch.spec,
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

  private async scheduleDevelopmentGrading(params: ScheduleConfirmedBatchParams): Promise<void> {
    let engine: RubricEngine;
    try {
      engine = await this.rubricGrading.engineFor(params.orgId);
    } catch (error) {
      reportServerError(error, {
        orgId: params.orgId,
        batchId: params.batchId,
        stage: 'resolve_rubric_engine',
      });
      return;
    }
    if (engine === 'rubric_grading') {
      this.rubricGrading.scheduleForBatch(params.orgId, params.batchId);
      return;
    }
    this.developmentGrading.scheduleConfirmedBatch(params);
  }

  private async linkConfirmedReadings(
    orgId: string,
    batchId: string,
    input: ConfirmedReadingsInput,
  ): Promise<void> {
    try {
      await this.readingConsolidation.linkConfirmedResponses(orgId, input);
    } catch (error) {
      reportServerError(error, { orgId, batchId, stage: 'link_answer_readings' });
    }
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
        sourceFileId: sheetScans.sourceFileId,
        sourcePageIndex: sheetScans.sourcePageIndex,
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
    kind: 'pending' | 'auto' | 'all',
  ): Promise<MarkQueueRow[]> {
    const condition =
      kind === 'all'
        ? and(ne(sheetScans.state, 'quality_rejected'), isNotNull(sheetScans.printedSheetId))
        : kind === 'pending'
          ? isNull(sheetScanMarks.reviewedAt)
          : and(eq(sheetScanMarks.autoResolved, true), isNull(sheetScanMarks.reviewedById));
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
        suggestedValue: sheetScanMarks.suggestedValue,
        doubtReason: sheetScanMarks.doubtReason,
        nullConfidence: sheetScanMarks.nullConfidence,
        reviewedValue: sheetScanMarks.reviewedValue,
        reviewDecision: sheetScanMarks.reviewDecision,
        reviewedById: sheetScanMarks.reviewedById,
        autoResolved: sheetScanMarks.autoResolved,
        aiResolution: sheetScanMarks.aiResolution,
      })
      .from(sheetScanMarks)
      .innerJoin(sheetScans, eq(sheetScans.id, sheetScanMarks.scanId))
      .where(
        and(
          eq(sheetScanMarks.orgId, orgId),
          eq(sheetScans.batchId, batchId),
          ne(sheetScans.state, 'superseded'),
          inArray(sheetScanMarks.state, PENDING_MARK_STATES),
          condition,
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
        sourceFileId: sheetScans.sourceFileId,
        sourcePageIndex: sheetScans.sourcePageIndex,
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
    return new Map(
      [...(await this.buildFileIndex(tx, orgId, fileIds))].map(([id, f]) => [id, f.url]),
    );
  }

  /**
   * URL y tipo de contenido por archivo. El tipo importa: el archivo subido puede
   * ser un PDF con todas las páginas del lote, y quien lo pinte necesita saberlo
   * para no apuntarle un `<img>` (que falla en silencio).
   */
  private async buildFileIndex(
    tx: Database,
    orgId: string,
    fileIds: string[],
  ): Promise<Map<string, { url: string | null; contentType: string | null }>> {
    const index = new Map<string, { url: string | null; contentType: string | null }>();
    if (fileIds.length === 0) return index;
    const uniqueIds = Array.from(new Set(fileIds));
    const rows: FileRecord[] = await tx
      .select()
      .from(files)
      .where(and(eq(files.orgId, orgId), inArray(files.id, uniqueIds)));
    for (const row of rows) {
      index.set(row.id, {
        url: this.filesService.buildDownloadUrl(row, 'inline') ?? null,
        contentType: row.mimeType ?? null,
      });
    }
    return index;
  }

  private cropItemsByPrintedNumber(spec: LayoutSpec): Map<string, string | null> {
    const itemByPrintedNumber = new Map<string, string | null>();
    for (const field of spec.fields) {
      if (field.kind !== 'crop_region') continue;
      itemByPrintedNumber.set(field.printedNumber, field.response?.itemId ?? null);
    }
    return itemByPrintedNumber;
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
    fileIndex?: Map<string, { url: string | null; contentType: string | null }>,
  ): ReviewScanModel {
    const source = scan.sourceFileId ? fileIndex?.get(scan.sourceFileId) : undefined;
    return {
      scanId: scan.scanId,
      state: scan.state,
      rejectReason: scan.quality.rejectReason ?? null,
      marksReadability: scan.quality.marksReadability ?? null,
      sheetSequence: scan.sheetSequence,
      pageIndex: scan.pageIndex,
      studentId: scan.resolvedStudentId ?? scan.sheetStudentId,
      studentName: this.studentNameOf(scan),
      identityConfidence: scan.identityConfidence !== null ? Number(scan.identityConfidence) : null,
      thumbUrl: scan.thumbFileId ? (urlByFileId.get(scan.thumbFileId) ?? null) : null,
      sourceUrl: source?.url ?? null,
      sourceContentType: source?.contentType ?? null,
      sourcePageIndex: scan.sourcePageIndex,
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
      suggestedValue: mark.suggestedValue ?? null,
      doubtReason: mark.doubtReason ?? null,
      nullConfidence: this.decimalOrNull(mark.nullConfidence),
      reviewedValue: mark.reviewedValue,
      reviewedDecision: mark.reviewDecision,
      reviewedById: mark.reviewedById,
      autoResolved: mark.autoResolved ?? false,
      aiResolution: this.teacherAiResolution(mark.aiResolution),
    };
  }

  private teacherAiResolution(
    resolution: MarkAiResolution | null | undefined,
  ): ReviewMarkAiResolutionModel | null {
    if (!resolution || resolution.mode !== 'live') return null;
    if (resolution.applied) {
      if (resolution.verdict === 'agree') {
        return { verdict: 'agree', value: resolution.value, agreement: 'both' };
      }
      if (resolution.verdict === 'solo_a' || resolution.verdict === 'solo_b') {
        return { verdict: resolution.verdict, value: resolution.value, agreement: 'single' };
      }
      return null;
    }
    if (resolution.verdict === 'conflict') {
      return { verdict: 'conflict', value: null, agreement: null };
    }
    return null;
  }

  private decimalOrNull(value: string | null | undefined): number | null {
    return value == null ? null : Number(value);
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
