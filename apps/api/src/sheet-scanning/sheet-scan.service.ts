import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
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
import {
  DEFAULT_CAPTURE_PROFILES,
  MARK_STATES,
  SHEET_SCAN_STATES,
  parseOmrQrPayload,
  type AssessCaptureDto,
  type AssessCaptureIdentityModel,
  type AssessCaptureResponse,
  type BatchCountersModel,
  type BatchStatusModel,
  type CaptureProfile,
  type CreateScanBatchDto,
  type CreateScanBatchResponse,
  type LayoutSpec,
  type MarkState,
  type OmrAssessResult,
  type OmrQrPayload,
  type OmrReadRequest,
  type PaginatedResponse,
  type ScanBatchQueryDto,
  type ScanUploadIntent,
  type ScannedPage,
  type SheetScanBatchStatus,
  type SheetScanState,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import { FilesService } from '../files/files.service';
import { JOB_DISPATCHER, type JobDispatcher } from '../jobs/job-dispatcher';
import { reportServerError } from '../common/observability/report-error';
import {
  OMR_CLIENT,
  OmrPageTimeoutError,
  OmrServiceUnavailableError,
  OmrSourceUnreadableError,
  type OmrClient,
} from './omr-client.types';
import { SheetIdentityResolverRegistry } from './identity/identity-resolver.registry';
import type { IdentityCandidate } from './identity/identity-resolver.types';
import { identityModeOf } from './sheet-layout.helpers';
import { OmrCalibrationService } from './omr-calibration.service';

const ALLOWED_SOURCE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
]);

const RETRYABLE_FAILURE_MESSAGE =
  'El servicio de lectura de hojas no está disponible o excedió el tiempo límite. Reintenta el procesamiento del lote; no es necesario volver a subir los archivos.';

const SOURCE_UNREADABLE_FAILURE_MESSAGE =
  'El servicio de lectura de hojas respondió correctamente, pero no pudo descargar ni abrir los archivos subidos. El servicio NO está caído: revisa que los archivos del lote sigan disponibles y sean PDF o imágenes válidas. Reintentar sin corregir el archivo dará el mismo resultado.';

const UNEXPECTED_FAILURE_MESSAGE =
  'Ocurrió un error inesperado al procesar el lote. Reintenta el procesamiento; si el problema persiste, contacta a soporte.';

type JobContext = {
  printRunId: string;
  spec: LayoutSpec;
  specHash: string;
  captureProfile: CaptureProfile;
  sourceFiles: FileRecord[];
};

type RunSheetLookup = {
  sequence: number;
  studentId: string | null;
  studentFirstName: string | null;
  studentLastName: string | null;
};

type BatchRow = {
  id: string;
  printRunId: string;
  status: SheetScanBatchStatus;
  captureProfile: CaptureProfile;
  pagesTotal: number | null;
  pagesRead: number;
  reviewPending: number;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  sheetCount: number;
};

type IdempotencyDecision = {
  skip: boolean;
  supersededIds: string[];
  supersedesId: string | null;
};

type EvidenceUploadParams = {
  base64: string;
  fileName: string;
  ownerType: string;
  ownerId: string;
  purpose: string;
};

@Injectable()
export class SheetScanService {
  private readonly logger = new Logger(SheetScanService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly filesService: FilesService,
    private readonly identityResolvers: SheetIdentityResolverRegistry,
    private readonly omrCalibrationService: OmrCalibrationService,
    @Inject(OMR_CLIENT) private readonly omrClient: OmrClient,
    @Inject(JOB_DISPATCHER) private readonly dispatcher: JobDispatcher,
  ) {}

  async createBatch(
    orgId: string,
    userId: string,
    dto: CreateScanBatchDto,
  ): Promise<CreateScanBatchResponse> {
    const invalidSources = dto.sources.filter(
      (source) => !ALLOWED_SOURCE_MIME_TYPES.has(source.mimeType),
    );
    if (invalidSources.length > 0) {
      throw new BadRequestException(
        `Formato de archivo no soportado: ${invalidSources
          .map((source) => `${source.fileName} (${source.mimeType})`)
          .join(', ')}. Sube el lote como PDF, JPEG, PNG o HEIC.`,
      );
    }

    const batchId = await withOrgContext(this.db, orgId, async (tx) => {
      const [run] = await tx
        .select({ id: sheetPrintRuns.id })
        .from(sheetPrintRuns)
        .where(and(eq(sheetPrintRuns.orgId, orgId), eq(sheetPrintRuns.id, dto.printRunId)))
        .limit(1);
      if (!run) throw new NotFoundException('Tirada de impresión no encontrada');

      const [batch] = await tx
        .insert(sheetScanBatches)
        .values({
          orgId,
          printRunId: run.id,
          status: 'pending',
          captureProfile: dto.captureProfile,
          sourceFileIds: [],
          createdById: userId,
        })
        .returning({ id: sheetScanBatches.id });
      if (!batch) throw new BadRequestException('No se pudo crear el lote de escaneo');
      return batch.id;
    });

    const uploads: ScanUploadIntent[] = [];
    for (const [index, source] of dto.sources.entries()) {
      const { file, upload } = await this.filesService.createUploadIntent({
        orgId,
        fileName: source.fileName,
        mimeType: source.mimeType,
        sizeBytes: source.sizeBytes,
        ownerType: 'sheet_scan',
        ownerId: batchId,
        purpose: 'scan_source',
        createdById: userId,
      });
      uploads.push({
        sourceIndex: index,
        fileId: file.id,
        uploadUrl: upload.uploadUrl,
        method: upload.method,
        headers: upload.headers,
        expiresIn: upload.expiresIn,
      });
    }

    await withOrgContext(this.db, orgId, (tx) =>
      tx
        .update(sheetScanBatches)
        .set({ sourceFileIds: uploads.map((u) => u.fileId), updatedAt: new Date() })
        .where(and(eq(sheetScanBatches.id, batchId), eq(sheetScanBatches.orgId, orgId))),
    );

    return { batchId, uploads };
  }

  async startProcessing(orgId: string, userId: string, batchId: string): Promise<BatchStatusModel> {
    await this.prepareForProcessing(
      orgId,
      batchId,
      ['pending', 'failed'],
      (status) =>
        `El lote no se puede procesar: su estado actual es "${status}". Sólo un lote pendiente o fallido puede iniciar el procesamiento.`,
    );
    this.enqueueJob(orgId, userId, batchId);
    return this.getBatch(orgId, batchId);
  }

  async retry(orgId: string, userId: string, batchId: string): Promise<BatchStatusModel> {
    await this.prepareForProcessing(
      orgId,
      batchId,
      ['failed'],
      (status) => `Sólo un lote fallido se puede reintentar: el estado actual es "${status}".`,
    );
    this.enqueueJob(orgId, userId, batchId);
    return this.getBatch(orgId, batchId);
  }

  async getBatch(orgId: string, batchId: string): Promise<BatchStatusModel> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const [row] = await this.selectBatchRows(tx, orgId, eq(sheetScanBatches.id, batchId));
      if (!row) throw new NotFoundException('Lote de escaneo no encontrado');
      const counters = await this.loadCounters(
        tx,
        orgId,
        [row.id],
        new Map([[row.id, row.sheetCount]]),
      );
      return this.toBatchModel(row, counters.get(row.id) ?? this.emptyCounters(row.sheetCount));
    });
  }

  async list(
    orgId: string,
    query: ScanBatchQueryDto,
  ): Promise<PaginatedResponse<BatchStatusModel>> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const filters = and(
        eq(sheetScanBatches.orgId, orgId),
        query.printRunId ? eq(sheetScanBatches.printRunId, query.printRunId) : undefined,
        query.status ? eq(sheetScanBatches.status, query.status) : undefined,
      );

      const [countRow] = await tx
        .select({ total: sql<number>`count(*)` })
        .from(sheetScanBatches)
        .where(filters);

      const rows = await this.selectBatchRows(tx, orgId, filters, {
        page: query.page,
        limit: query.limit,
      });

      const counters =
        rows.length > 0
          ? await this.loadCounters(
              tx,
              orgId,
              rows.map((r) => r.id),
              new Map(rows.map((r) => [r.id, r.sheetCount])),
            )
          : new Map<string, BatchCountersModel>();

      return {
        data: rows.map((row) =>
          this.toBatchModel(row, counters.get(row.id) ?? this.emptyCounters(row.sheetCount)),
        ),
        total: Number(countRow?.total ?? 0),
        page: query.page,
        limit: query.limit,
      };
    });
  }

  private enqueueJob(orgId: string, userId: string, batchId: string): void {
    this.dispatcher.enqueue({
      id: batchId,
      kind: 'sheet_scan',
      run: () => this.runJob(orgId, userId, batchId),
    });
  }

  private async prepareForProcessing(
    orgId: string,
    batchId: string,
    allowedStatuses: SheetScanBatchStatus[],
    buildStatusMessage: (status: SheetScanBatchStatus) => string,
  ): Promise<void> {
    await withOrgContext(this.db, orgId, async (tx) => {
      const [batch] = await tx
        .select({ status: sheetScanBatches.status, sourceFileIds: sheetScanBatches.sourceFileIds })
        .from(sheetScanBatches)
        .where(and(eq(sheetScanBatches.id, batchId), eq(sheetScanBatches.orgId, orgId)))
        .limit(1);
      if (!batch) throw new NotFoundException('Lote de escaneo no encontrado');
      if (!allowedStatuses.includes(batch.status)) {
        throw new BadRequestException(buildStatusMessage(batch.status));
      }

      const fileRows = await tx
        .select({ id: files.id, status: files.status })
        .from(files)
        .where(and(inArray(files.id, batch.sourceFileIds), isNull(files.deletedAt)));
      const readyIds = new Set(
        fileRows.filter((file) => file.status === 'ready').map((file) => file.id),
      );
      const notReadyCount = batch.sourceFileIds.filter((id) => !readyIds.has(id)).length;
      if (batch.sourceFileIds.length === 0 || notReadyCount > 0) {
        throw new BadRequestException(
          `Aún hay ${notReadyCount} de ${batch.sourceFileIds.length} archivos sin subir. Completa las subidas antes de iniciar el procesamiento.`,
        );
      }

      await tx
        .update(sheetScanBatches)
        .set({ status: 'processing', failureReason: null, updatedAt: new Date() })
        .where(and(eq(sheetScanBatches.id, batchId), eq(sheetScanBatches.orgId, orgId)));
    });
  }

  async assessCapture(orgId: string, dto: AssessCaptureDto): Promise<AssessCaptureResponse> {
    const run = await this.loadRunForAssess(orgId, dto.printRunId);
    const captureProfile = await this.calibratedProfile(orgId, DEFAULT_CAPTURE_PROFILES.phone);

    const assessed = await this.omrClient.assess({
      layoutSpec: run.spec,
      captureProfile,
      imageBase64: dto.imageBase64,
    });

    const page: ScannedPage = {
      pageIndex: 0,
      imageSha256: assessed.imageSha256,
      quality: assessed.quality,
      identity: assessed.identity,
      marks: [],
      pageThumbJpegBase64: null,
    };
    const resolver = this.identityResolvers.forMode(identityModeOf(run.spec));
    const candidate = await resolver.resolve(orgId, page, { printRunId: dto.printRunId });
    const { identity, belongsToRun } = await this.buildAssessIdentity(
      orgId,
      dto.printRunId,
      assessed,
      candidate,
    );

    return {
      accepted: assessed.quality.ok && candidate.batchRejection === null && belongsToRun,
      quality: assessed.quality,
      identity,
    };
  }

  private async loadRunForAssess(
    orgId: string,
    printRunId: string,
  ): Promise<{ spec: LayoutSpec; specHash: string }> {
    const [run] = await withOrgContext(this.db, orgId, (tx) =>
      tx
        .select({ spec: sheetLayouts.spec, specHash: sheetLayouts.specHash })
        .from(sheetPrintRuns)
        .innerJoin(sheetLayouts, eq(sheetLayouts.id, sheetPrintRuns.layoutId))
        .where(and(eq(sheetPrintRuns.orgId, orgId), eq(sheetPrintRuns.id, printRunId)))
        .limit(1),
    );
    if (!run) throw new NotFoundException('Tirada de impresión no encontrada');
    return run;
  }

  private async buildAssessIdentity(
    orgId: string,
    printRunId: string,
    assessed: OmrAssessResult,
    candidate: IdentityCandidate,
  ): Promise<{ identity: AssessCaptureIdentityModel; belongsToRun: boolean }> {
    const qrPayload = this.qrPayloadOf(assessed.identity);
    const evidenceName = candidate.evidence.alumno;
    const fallbackName = typeof evidenceName === 'string' ? evidenceName : null;

    if (candidate.printedSheetId === null) {
      return {
        identity: {
          printedSheetId: null,
          pageIndex: null,
          sheetSequence: null,
          studentId: candidate.studentId,
          studentName: candidate.studentId === null ? null : fallbackName,
          confidence: candidate.confidence,
        },
        belongsToRun: true,
      };
    }

    const sheet = await this.findRunSheet(orgId, printRunId, candidate.printedSheetId);
    if (!sheet) {
      return {
        identity: {
          printedSheetId: null,
          pageIndex: null,
          sheetSequence: null,
          studentId: null,
          studentName: null,
          confidence: 0,
        },
        belongsToRun: false,
      };
    }

    const sheetName = [sheet.studentFirstName, sheet.studentLastName]
      .filter((part): part is string => part !== null && part.length > 0)
      .join(' ');
    return {
      identity: {
        printedSheetId: candidate.printedSheetId,
        pageIndex: qrPayload?.pageIndex ?? null,
        sheetSequence: sheet.sequence,
        studentId: candidate.studentId,
        studentName: sheetName.length > 0 ? sheetName : fallbackName,
        confidence: candidate.confidence,
      },
      belongsToRun: true,
    };
  }

  private async findRunSheet(
    orgId: string,
    printRunId: string,
    printedSheetId: string,
  ): Promise<RunSheetLookup | null> {
    const [sheet] = await withOrgContext(this.db, orgId, (tx) =>
      tx
        .select({
          sequence: printedSheets.sequence,
          studentId: printedSheets.studentId,
          studentFirstName: students.firstName,
          studentLastName: students.lastName,
        })
        .from(printedSheets)
        .leftJoin(students, eq(students.id, printedSheets.studentId))
        .where(
          and(
            eq(printedSheets.orgId, orgId),
            eq(printedSheets.id, printedSheetId),
            eq(printedSheets.printRunId, printRunId),
          ),
        )
        .limit(1),
    );
    return sheet ?? null;
  }

  private async calibratedProfile(orgId: string, profile: CaptureProfile): Promise<CaptureProfile> {
    if (profile.ambiguityMargin !== null) return profile;
    const { calibration } = await this.omrCalibrationService.getCalibration(orgId);
    return { ...profile, ambiguityMargin: calibration.ambiguityMargin ?? null };
  }

  private async runJob(orgId: string, userId: string, batchId: string): Promise<void> {
    try {
      const context = await this.loadJobContext(orgId, batchId);
      context.captureProfile = await this.calibratedProfile(orgId, context.captureProfile);
      const outcome = await this.processSources(orgId, batchId, context);
      if (outcome.rejectionReason !== null) {
        await this.updateBatch(orgId, batchId, {
          status: 'rejected',
          failureReason: outcome.rejectionReason,
        });
        return;
      }
      await this.finalizeBatch(orgId, batchId, outcome.pagesTotal);
    } catch (err) {
      if (err instanceof OmrSourceUnreadableError) {
        reportServerError(err, { batchId, orgId, userId });
        await this.updateBatch(orgId, batchId, {
          status: 'failed',
          failureReason: SOURCE_UNREADABLE_FAILURE_MESSAGE,
        });
        return;
      }
      if (err instanceof OmrServiceUnavailableError || err instanceof OmrPageTimeoutError) {
        await this.updateBatch(orgId, batchId, {
          status: 'failed',
          failureReason: RETRYABLE_FAILURE_MESSAGE,
        });
        return;
      }
      reportServerError(err, { batchId, orgId, userId });
      await this.updateBatch(orgId, batchId, {
        status: 'failed',
        failureReason: UNEXPECTED_FAILURE_MESSAGE,
      });
    }
  }

  private async loadJobContext(orgId: string, batchId: string): Promise<JobContext> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const [row] = await tx
        .select({
          printRunId: sheetScanBatches.printRunId,
          sourceFileIds: sheetScanBatches.sourceFileIds,
          captureProfile: sheetScanBatches.captureProfile,
          spec: sheetLayouts.spec,
          specHash: sheetLayouts.specHash,
        })
        .from(sheetScanBatches)
        .innerJoin(sheetPrintRuns, eq(sheetPrintRuns.id, sheetScanBatches.printRunId))
        .innerJoin(sheetLayouts, eq(sheetLayouts.id, sheetPrintRuns.layoutId))
        .where(and(eq(sheetScanBatches.id, batchId), eq(sheetScanBatches.orgId, orgId)))
        .limit(1);
      if (!row) throw new NotFoundException('Lote de escaneo no encontrado');

      const fileRows = await tx.select().from(files).where(inArray(files.id, row.sourceFileIds));
      const byId = new Map(fileRows.map((file) => [file.id, file]));
      const sourceFiles = row.sourceFileIds
        .map((id) => byId.get(id))
        .filter((file): file is FileRecord => file !== undefined);

      return {
        printRunId: row.printRunId,
        spec: row.spec,
        specHash: row.specHash,
        captureProfile: row.captureProfile,
        sourceFiles,
      };
    });
  }

  private async processSources(
    orgId: string,
    batchId: string,
    context: JobContext,
  ): Promise<{ rejectionReason: string | null; pagesTotal: number }> {
    let pagesTotal = 0;
    const resolver = this.identityResolvers.forMode(identityModeOf(context.spec));
    for (const sourceFile of context.sourceFiles) {
      const result = await this.omrClient.read(this.buildReadRequest(context, sourceFile));
      pagesTotal += result.pages.length;
      for (const page of result.pages) {
        const batchHashMismatch = this.detectBatchLayoutMismatch(context, page);
        if (batchHashMismatch !== null) {
          return { rejectionReason: batchHashMismatch, pagesTotal };
        }
        const candidate = await resolver.resolve(orgId, page, {
          printRunId: context.printRunId,
        });
        if (candidate.batchRejection !== null) {
          return { rejectionReason: candidate.batchRejection.reason, pagesTotal };
        }
        await this.persistPage(orgId, batchId, sourceFile.id, page, candidate);
      }
    }
    return { rejectionReason: null, pagesTotal };
  }

  private qrPayloadOf(identity: ScannedPage['identity']): OmrQrPayload | null {
    const qrRaw = identity.qrRaw ?? (identity.mode === 'qr' ? identity.raw : null);
    return qrRaw === null ? null : parseOmrQrPayload(qrRaw);
  }

  private detectBatchLayoutMismatch(context: JobContext, page: ScannedPage): string | null {
    const payload = this.qrPayloadOf(page.identity);
    if (payload === null) return null;
    if (payload.layoutHash === context.specHash.toLowerCase()) return null;
    return `El diseño impreso en las hojas (hash ${payload.layoutHash}) no coincide con el diseño de la tirada de este lote (hash ${context.specHash}). El instrumento fue editado o las hojas pertenecen a otra tirada: reimprime las hojas o crea el lote sobre la tirada correcta. Ninguna hoja de este lote fue corregida.`;
  }

  private buildReadRequest(context: JobContext, sourceFile: FileRecord): OmrReadRequest {
    const url = this.filesService.buildDownloadUrl(sourceFile);
    if (!url) {
      throw new Error(
        `No se pudo emitir la URL de descarga del archivo ${sourceFile.id}: storage no configurado`,
      );
    }
    const source =
      sourceFile.mimeType === 'application/pdf'
        ? { kind: 'pdf' as const, pdfUrl: url, imageUrls: null }
        : { kind: 'images' as const, pdfUrl: null, imageUrls: [url] };
    return { layoutSpec: context.spec, captureProfile: context.captureProfile, source };
  }

  private async persistPage(
    orgId: string,
    batchId: string,
    sourceFileId: string,
    page: ScannedPage,
    candidate: IdentityCandidate,
  ): Promise<void> {
    const qrPayload = this.qrPayloadOf(page.identity);
    const pageIndex = qrPayload?.pageIndex ?? page.pageIndex;

    const decision =
      candidate.printedSheetId === null
        ? await this.checkUnidentifiedDuplicate(orgId, batchId, page.imageSha256)
        : await this.checkIdempotency(orgId, candidate.printedSheetId, pageIndex, page.imageSha256);
    if (decision.skip) return;

    const scanId = randomUUID();
    const markIdByField = new Map(page.marks.map((mark) => [mark.fieldId, randomUUID()]));
    const thumbFileId =
      page.pageThumbJpegBase64 === null
        ? null
        : await this.uploadEvidenceFile(orgId, {
            base64: page.pageThumbJpegBase64,
            fileName: `scan-${scanId}-thumb.jpg`,
            ownerType: 'sheet_scan',
            ownerId: scanId,
            purpose: 'scan_thumb',
          });
    const cropFileIdByField = new Map<string, string | null>();
    for (const mark of page.marks) {
      if (mark.cropJpegBase64 === null) continue;
      const markId = markIdByField.get(mark.fieldId) as string;
      cropFileIdByField.set(
        mark.fieldId,
        await this.uploadEvidenceFile(orgId, {
          base64: mark.cropJpegBase64,
          fileName: `mark-${markId}-crop.jpg`,
          ownerType: 'sheet_scan_mark',
          ownerId: markId,
          purpose: 'mark_crop',
        }),
      );
    }

    await withOrgContext(this.db, orgId, async (tx) => {
      if (decision.supersededIds.length > 0) {
        await tx
          .update(sheetScans)
          .set({ state: 'superseded' })
          .where(inArray(sheetScans.id, decision.supersededIds));
      }

      await tx.insert(sheetScans).values({
        id: scanId,
        orgId,
        batchId,
        printedSheetId: candidate.printedSheetId,
        pageIndex,
        sourceFileId,
        sourcePageIndex: page.pageIndex,
        imageHash: page.imageSha256,
        state: this.resolveScanState(page, candidate),
        quality: page.quality,
        resolvedStudentId: candidate.studentId,
        identityConfidence: candidate.confidence.toFixed(3),
        identityEvidence: candidate.evidence,
        thumbFileId,
        supersedesId: decision.supersedesId,
      });

      if (page.marks.length > 0) {
        await tx.insert(sheetScanMarks).values(
          page.marks.map((mark) => ({
            id: markIdByField.get(mark.fieldId),
            orgId,
            scanId,
            fieldId: mark.fieldId,
            printedNumber: mark.printedNumber,
            state: mark.state,
            value: mark.value,
            fill: mark.fill.toFixed(3),
            threshold: mark.threshold.toFixed(3),
            margin: Math.min(mark.margin, 999.999).toFixed(3),
            cropFileId: cropFileIdByField.get(mark.fieldId) ?? null,
          })),
        );
      }
    });
  }

  private async checkIdempotency(
    orgId: string,
    printedSheetId: string,
    pageIndex: number,
    imageHash: string,
  ): Promise<IdempotencyDecision> {
    const existing = await withOrgContext(this.db, orgId, (tx) =>
      tx
        .select({ id: sheetScans.id, imageHash: sheetScans.imageHash, state: sheetScans.state })
        .from(sheetScans)
        .where(
          and(
            eq(sheetScans.orgId, orgId),
            eq(sheetScans.printedSheetId, printedSheetId),
            eq(sheetScans.pageIndex, pageIndex),
          ),
        ),
    );

    if (existing.some((scan) => scan.imageHash === imageHash && scan.state !== 'superseded')) {
      return { skip: true, supersededIds: [], supersedesId: null };
    }
    const active = existing.filter((scan) => scan.state !== 'superseded');
    return {
      skip: false,
      supersededIds: active.map((scan) => scan.id),
      supersedesId: active.length > 0 ? active[active.length - 1].id : null,
    };
  }

  private async checkUnidentifiedDuplicate(
    orgId: string,
    batchId: string,
    imageHash: string,
  ): Promise<IdempotencyDecision> {
    const existing = await withOrgContext(this.db, orgId, (tx) =>
      tx
        .select({ id: sheetScans.id })
        .from(sheetScans)
        .where(
          and(
            eq(sheetScans.orgId, orgId),
            eq(sheetScans.batchId, batchId),
            eq(sheetScans.imageHash, imageHash),
            isNull(sheetScans.printedSheetId),
          ),
        )
        .limit(1),
    );
    if (existing.length > 0) {
      return { skip: true, supersededIds: [], supersedesId: null };
    }
    return { skip: false, supersededIds: [], supersedesId: null };
  }

  private resolveScanState(page: ScannedPage, candidate: IdentityCandidate): SheetScanState {
    if (!page.quality.ok) return 'quality_rejected';
    if (candidate.studentId === null) return 'identity_unresolved';
    return 'read';
  }

  private async uploadEvidenceFile(
    orgId: string,
    params: EvidenceUploadParams,
  ): Promise<string | null> {
    try {
      const buffer = Buffer.from(params.base64, 'base64');
      const { file, upload } = await this.filesService.createUploadIntent({
        orgId,
        fileName: params.fileName,
        mimeType: 'image/jpeg',
        sizeBytes: buffer.byteLength,
        ownerType: params.ownerType,
        ownerId: params.ownerId,
        purpose: params.purpose,
      });
      const response = await fetch(upload.uploadUrl, {
        method: upload.method,
        headers: upload.headers,
        body: new Uint8Array(buffer),
      });
      if (!response.ok) {
        this.logger.warn(
          `No se pudo subir la evidencia "${params.fileName}": HTTP ${response.status}`,
        );
        return null;
      }
      await this.filesService.confirm({ orgId, fileId: file.id, sizeBytes: buffer.byteLength });
      return file.id;
    } catch (err) {
      this.logger.warn(
        `No se pudo persistir la evidencia "${params.fileName}": ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async finalizeBatch(orgId: string, batchId: string, pagesTotal: number): Promise<void> {
    await withOrgContext(this.db, orgId, async (tx) => {
      const scanRows = await tx
        .select({ state: sheetScans.state, count: sql<number>`count(*)` })
        .from(sheetScans)
        .where(and(eq(sheetScans.orgId, orgId), eq(sheetScans.batchId, batchId)))
        .groupBy(sheetScans.state);

      const scansByState = this.emptyCounters(0).scans;
      for (const row of scanRows) {
        scansByState[row.state] = Number(row.count);
      }

      const [pendingMarks] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(sheetScanMarks)
        .innerJoin(sheetScans, eq(sheetScans.id, sheetScanMarks.scanId))
        .where(
          and(
            eq(sheetScans.orgId, orgId),
            eq(sheetScans.batchId, batchId),
            ne(sheetScans.state, 'superseded'),
            inArray(sheetScanMarks.state, ['multiple', 'ambiguous']),
            isNull(sheetScanMarks.reviewedAt),
          ),
        );

      const reviewPending =
        scansByState.quality_rejected +
        scansByState.identity_unresolved +
        Number(pendingMarks?.count ?? 0);

      await tx
        .update(sheetScanBatches)
        .set({
          status: 'needs_review',
          pagesTotal,
          pagesRead: scansByState.read,
          reviewPending,
          failureReason: null,
          updatedAt: new Date(),
        })
        .where(and(eq(sheetScanBatches.id, batchId), eq(sheetScanBatches.orgId, orgId)));
    });
  }

  private async updateBatch(
    orgId: string,
    batchId: string,
    set: { status: SheetScanBatchStatus; failureReason: string | null },
  ): Promise<void> {
    await withOrgContext(this.db, orgId, (tx) =>
      tx
        .update(sheetScanBatches)
        .set({ ...set, updatedAt: new Date() })
        .where(and(eq(sheetScanBatches.id, batchId), eq(sheetScanBatches.orgId, orgId))),
    );
  }

  private selectBatchRows(
    tx: Database,
    orgId: string,
    filters: ReturnType<typeof and>,
    pagination?: { page: number; limit: number },
  ): Promise<BatchRow[]> {
    const base = tx
      .select({
        id: sheetScanBatches.id,
        printRunId: sheetScanBatches.printRunId,
        status: sheetScanBatches.status,
        captureProfile: sheetScanBatches.captureProfile,
        pagesTotal: sheetScanBatches.pagesTotal,
        pagesRead: sheetScanBatches.pagesRead,
        reviewPending: sheetScanBatches.reviewPending,
        failureReason: sheetScanBatches.failureReason,
        createdAt: sheetScanBatches.createdAt,
        updatedAt: sheetScanBatches.updatedAt,
        sheetCount: sheetPrintRuns.sheetCount,
      })
      .from(sheetScanBatches)
      .innerJoin(sheetPrintRuns, eq(sheetPrintRuns.id, sheetScanBatches.printRunId))
      .where(and(eq(sheetScanBatches.orgId, orgId), filters))
      .orderBy(desc(sheetScanBatches.createdAt));

    if (!pagination) return base.limit(1);
    return base.limit(pagination.limit).offset((pagination.page - 1) * pagination.limit);
  }

  private async loadCounters(
    tx: Database,
    orgId: string,
    batchIds: string[],
    sheetCountByBatch: Map<string, number>,
  ): Promise<Map<string, BatchCountersModel>> {
    const scanRows = await tx
      .select({
        batchId: sheetScans.batchId,
        state: sheetScans.state,
        count: sql<number>`count(*)`,
      })
      .from(sheetScans)
      .where(and(eq(sheetScans.orgId, orgId), inArray(sheetScans.batchId, batchIds)))
      .groupBy(sheetScans.batchId, sheetScans.state);

    const markRows = await tx
      .select({
        batchId: sheetScans.batchId,
        state: sheetScanMarks.state,
        count: sql<number>`count(*)`,
      })
      .from(sheetScanMarks)
      .innerJoin(sheetScans, eq(sheetScans.id, sheetScanMarks.scanId))
      .where(
        and(
          eq(sheetScans.orgId, orgId),
          inArray(sheetScans.batchId, batchIds),
          ne(sheetScans.state, 'superseded'),
        ),
      )
      .groupBy(sheetScans.batchId, sheetScanMarks.state);

    const scannedRows = await tx
      .select({
        batchId: sheetScans.batchId,
        count: sql<number>`count(distinct ${sheetScans.printedSheetId})`,
      })
      .from(sheetScans)
      .where(
        and(
          eq(sheetScans.orgId, orgId),
          inArray(sheetScans.batchId, batchIds),
          eq(sheetScans.state, 'read'),
        ),
      )
      .groupBy(sheetScans.batchId);

    const counters = new Map<string, BatchCountersModel>();
    for (const id of batchIds) {
      counters.set(id, this.emptyCounters(sheetCountByBatch.get(id) ?? 0));
    }
    for (const row of scanRows) {
      const entry = counters.get(row.batchId);
      if (entry) entry.scans[row.state] = Number(row.count);
    }
    for (const row of markRows) {
      const entry = counters.get(row.batchId);
      if (entry) entry.marks[row.state] = Number(row.count);
    }
    for (const row of scannedRows) {
      const entry = counters.get(row.batchId);
      if (entry) entry.sheetsScanned = Number(row.count);
    }
    return counters;
  }

  private emptyCounters(sheetsExpected: number): BatchCountersModel {
    const marks = {} as Record<MarkState, number>;
    for (const state of MARK_STATES) marks[state] = 0;
    const scans = {} as Record<SheetScanState, number>;
    for (const state of SHEET_SCAN_STATES) scans[state] = 0;
    return { marks, scans, sheetsExpected, sheetsScanned: 0 };
  }

  private toBatchModel(row: BatchRow, counters: BatchCountersModel): BatchStatusModel {
    return {
      id: row.id,
      printRunId: row.printRunId,
      status: row.status,
      captureProfile: row.captureProfile,
      pagesTotal: row.pagesTotal,
      pagesRead: row.pagesRead,
      reviewPending: row.reviewPending,
      failureReason: row.failureReason,
      counters,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
