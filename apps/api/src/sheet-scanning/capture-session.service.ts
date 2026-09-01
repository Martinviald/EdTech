import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import {
  captureSessions,
  classGroups,
  instruments,
  sheetLayouts,
  sheetPrintRuns,
  sheetScanBatches,
  withCaptureSessionContext,
  withOrgContext,
  type CaptureSession,
} from '@soe/db';
import {
  CAPTURE_SESSION_MAX_CAPTURES,
  CAPTURE_SESSION_MAX_REDEEMS,
  CAPTURE_SESSION_TOKEN_SCOPE,
  CAPTURE_SESSION_TTL_MINUTES,
  DEFAULT_CAPTURE_PROFILES,
  type AssessCaptureResponse,
  type CaptureAssessDto,
  type CaptureConfirmFileDto,
  type CaptureSessionContextModel,
  type CaptureSessionStatusModel,
  type CaptureUploadIntentDto,
  type CreateCaptureSessionDto,
  type CreateCaptureSessionResponse,
  type FinishCaptureSessionResponse,
  type RedeemCaptureSessionDto,
  type RedeemCaptureSessionResponse,
  type ScanUploadIntent,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import { FilesService } from '../files/files.service';
import {
  captureSecretMatchesHash,
  deriveCaptureTokenKey,
  generateCaptureSecret,
  hashCaptureSecret,
  type ActiveCaptureSession,
} from './capture-token.helpers';
import { SheetScanService } from './sheet-scan.service';

const INVALID_REDEEM_MESSAGE =
  'Código QR inválido o vencido. Genera uno nuevo desde el computador.';
const MAX_REDEEMS_MESSAGE =
  'Este código QR ya alcanzó el máximo de usos. Genera uno nuevo desde el computador.';
const SESSION_NOT_ACTIVE_MESSAGE =
  'La sesión de captura ya no está activa. Escanea un nuevo código QR desde el computador.';
const SESSION_NOT_FOUND_MESSAGE = 'Sesión de captura no encontrada';

@Injectable()
export class CaptureSessionService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly config: ConfigService,
    private readonly filesService: FilesService,
    private readonly sheetScanService: SheetScanService,
  ) {}

  async create(
    orgId: string,
    userId: string,
    dto: CreateCaptureSessionDto,
  ): Promise<CreateCaptureSessionResponse> {
    const secret = generateCaptureSecret();
    const expiresAt = new Date(Date.now() + CAPTURE_SESSION_TTL_MINUTES * 60_000);

    return withOrgContext(this.db, orgId, async (tx) => {
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
          captureProfile: DEFAULT_CAPTURE_PROFILES.phone,
          sourceFileIds: [],
          createdById: userId,
        })
        .returning({ id: sheetScanBatches.id });
      if (!batch) throw new BadRequestException('No se pudo crear el lote de escaneo');

      const [session] = await tx
        .insert(captureSessions)
        .values({
          orgId,
          printRunId: run.id,
          batchId: batch.id,
          status: 'pending',
          secretHash: hashCaptureSecret(secret),
          expiresAt,
          createdById: userId,
        })
        .returning({ id: captureSessions.id });
      if (!session) throw new BadRequestException('No se pudo crear la sesión de captura');

      return { sessionId: session.id, batchId: batch.id, secret, expiresAt };
    });
  }

  async redeem(dto: RedeemCaptureSessionDto): Promise<RedeemCaptureSessionResponse> {
    const row = await withCaptureSessionContext(this.db, dto.sessionId, async (tx) => {
      const [session] = await tx
        .select()
        .from(captureSessions)
        .where(eq(captureSessions.id, dto.sessionId))
        .limit(1);
      return session ?? null;
    });
    if (!row || !captureSecretMatchesHash(dto.secret, row.secretHash)) {
      throw new UnauthorizedException(INVALID_REDEEM_MESSAGE);
    }
    await this.assertRedeemable(row);

    const context = await withOrgContext(this.db, row.orgId, async (tx) => {
      await tx
        .update(captureSessions)
        .set({
          status: 'active',
          redeemCount: sql`${captureSessions.redeemCount} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(captureSessions.id, row.id), eq(captureSessions.orgId, row.orgId)));
      return this.loadContext(tx, row.orgId, row.printRunId);
    });

    return {
      token: await this.signCaptureToken(row),
      expiresAt: row.expiresAt,
      context,
      capturedCount: row.captures.length,
    };
  }

  async getStatus(orgId: string, sessionId: string): Promise<CaptureSessionStatusModel> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const [row] = await tx
        .select()
        .from(captureSessions)
        .where(and(eq(captureSessions.id, sessionId), eq(captureSessions.orgId, orgId)))
        .limit(1);
      if (!row) throw new NotFoundException(SESSION_NOT_FOUND_MESSAGE);

      let status = row.status;
      if (
        (status === 'pending' || status === 'active') &&
        row.expiresAt.getTime() <= Date.now()
      ) {
        await tx
          .update(captureSessions)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(and(eq(captureSessions.id, sessionId), eq(captureSessions.orgId, orgId)));
        status = 'expired';
      }

      const context = await this.loadContext(tx, orgId, row.printRunId);
      return {
        id: row.id,
        status,
        batchId: row.batchId,
        printRunId: row.printRunId,
        expiresAt: row.expiresAt,
        redeemCount: row.redeemCount,
        captures: row.captures,
        context,
      };
    });
  }

  assess(session: ActiveCaptureSession, dto: CaptureAssessDto): Promise<AssessCaptureResponse> {
    return this.sheetScanService.assessCapture(session.orgId, {
      printRunId: session.printRunId,
      imageBase64: dto.imageBase64,
    });
  }

  async createUploadIntent(
    session: ActiveCaptureSession,
    dto: CaptureUploadIntentDto,
  ): Promise<ScanUploadIntent> {
    return withOrgContext(this.db, session.orgId, async (tx) => {
      const [row] = await tx
        .select({ status: captureSessions.status, captures: captureSessions.captures })
        .from(captureSessions)
        .where(
          and(eq(captureSessions.id, session.sessionId), eq(captureSessions.orgId, session.orgId)),
        )
        .limit(1);
      if (!row) throw new NotFoundException(SESSION_NOT_FOUND_MESSAGE);
      if (row.status !== 'active') throw new ConflictException(SESSION_NOT_ACTIVE_MESSAGE);
      if (row.captures.length >= CAPTURE_SESSION_MAX_CAPTURES) {
        throw new BadRequestException(
          `Alcanzaste el máximo de ${CAPTURE_SESSION_MAX_CAPTURES} fotos por sesión. Termina la captura para procesar el lote.`,
        );
      }

      const [batch] = await tx
        .select({
          status: sheetScanBatches.status,
          sourceFileIds: sheetScanBatches.sourceFileIds,
        })
        .from(sheetScanBatches)
        .where(
          and(eq(sheetScanBatches.id, session.batchId), eq(sheetScanBatches.orgId, session.orgId)),
        )
        .limit(1);
      if (!batch) throw new NotFoundException('Lote de escaneo no encontrado');
      if (batch.status !== 'pending') {
        throw new ConflictException('El lote ya entró a procesamiento y no acepta más fotos.');
      }

      const { file, upload } = await this.filesService.createUploadIntent({
        orgId: session.orgId,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        ownerType: 'sheet_scan',
        ownerId: session.batchId,
        purpose: 'scan_source',
      });

      await tx
        .update(sheetScanBatches)
        .set({ sourceFileIds: [...batch.sourceFileIds, file.id], updatedAt: new Date() })
        .where(
          and(eq(sheetScanBatches.id, session.batchId), eq(sheetScanBatches.orgId, session.orgId)),
        );
      await tx
        .update(captureSessions)
        .set({
          captures: [
            ...row.captures,
            {
              fileId: file.id,
              fileName: dto.fileName,
              identity: dto.identity,
              capturedAt: new Date().toISOString(),
            },
          ],
          updatedAt: new Date(),
        })
        .where(
          and(eq(captureSessions.id, session.sessionId), eq(captureSessions.orgId, session.orgId)),
        );

      return {
        sourceIndex: batch.sourceFileIds.length,
        fileId: file.id,
        uploadUrl: upload.uploadUrl,
        method: upload.method,
        headers: upload.headers,
        expiresIn: upload.expiresIn,
      };
    });
  }

  async confirmFile(
    session: ActiveCaptureSession,
    fileId: string,
    dto: CaptureConfirmFileDto,
  ): Promise<void> {
    const batch = await withOrgContext(this.db, session.orgId, async (tx) => {
      const [row] = await tx
        .select({ sourceFileIds: sheetScanBatches.sourceFileIds })
        .from(sheetScanBatches)
        .where(
          and(eq(sheetScanBatches.id, session.batchId), eq(sheetScanBatches.orgId, session.orgId)),
        )
        .limit(1);
      return row ?? null;
    });
    if (!batch) throw new NotFoundException('Lote de escaneo no encontrado');
    if (!batch.sourceFileIds.includes(fileId)) {
      throw new ForbiddenException('El archivo no pertenece al lote de esta sesión.');
    }
    await this.filesService.confirm({
      orgId: session.orgId,
      fileId,
      sizeBytes: dto.sizeBytes,
    });
  }

  async finish(
    orgId: string,
    sessionId: string,
    actorUserId: string | null,
  ): Promise<FinishCaptureSessionResponse> {
    const row = await this.requireSession(orgId, sessionId);
    if (row.status === 'closed') {
      return this.finishResponseFromBatch(orgId, row.batchId);
    }
    if (row.status === 'revoked' || row.status === 'expired') {
      throw new ConflictException(SESSION_NOT_ACTIVE_MESSAGE);
    }

    await withOrgContext(this.db, orgId, (tx) =>
      tx
        .update(captureSessions)
        .set({ status: 'closed', updatedAt: new Date() })
        .where(and(eq(captureSessions.id, sessionId), eq(captureSessions.orgId, orgId))),
    );

    if (row.captures.length === 0) {
      return this.finishResponseFromBatch(orgId, row.batchId);
    }

    const batch = await this.sheetScanService.startProcessing(
      orgId,
      actorUserId ?? row.createdById ?? '',
      row.batchId,
    );
    return { batchId: row.batchId, batchStatus: batch.status };
  }

  async revoke(orgId: string, sessionId: string): Promise<CaptureSessionStatusModel> {
    const row = await this.requireSession(orgId, sessionId);
    if (row.status === 'closed') {
      throw new ConflictException(
        'La sesión ya fue cerrada y su lote entró a procesamiento; no se puede revocar.',
      );
    }
    if (row.status !== 'revoked') {
      await withOrgContext(this.db, orgId, (tx) =>
        tx
          .update(captureSessions)
          .set({ status: 'revoked', updatedAt: new Date() })
          .where(and(eq(captureSessions.id, sessionId), eq(captureSessions.orgId, orgId))),
      );
    }
    return this.getStatus(orgId, sessionId);
  }

  private async requireSession(orgId: string, sessionId: string): Promise<CaptureSession> {
    const row = await withOrgContext(this.db, orgId, async (tx) => {
      const [session] = await tx
        .select()
        .from(captureSessions)
        .where(and(eq(captureSessions.id, sessionId), eq(captureSessions.orgId, orgId)))
        .limit(1);
      return session ?? null;
    });
    if (!row) throw new NotFoundException(SESSION_NOT_FOUND_MESSAGE);
    return row;
  }

  private async finishResponseFromBatch(
    orgId: string,
    batchId: string,
  ): Promise<FinishCaptureSessionResponse> {
    const batch = await this.sheetScanService.getBatch(orgId, batchId);
    return { batchId, batchStatus: batch.status };
  }

  private async assertRedeemable(row: CaptureSession): Promise<void> {
    if (row.status !== 'pending' && row.status !== 'active') {
      throw new UnauthorizedException(INVALID_REDEEM_MESSAGE);
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      await withOrgContext(this.db, row.orgId, (tx) =>
        tx
          .update(captureSessions)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(and(eq(captureSessions.id, row.id), eq(captureSessions.orgId, row.orgId))),
      );
      throw new UnauthorizedException(INVALID_REDEEM_MESSAGE);
    }
    if (row.redeemCount >= CAPTURE_SESSION_MAX_REDEEMS) {
      throw new UnauthorizedException(MAX_REDEEMS_MESSAGE);
    }
  }

  private async loadContext(
    tx: Database,
    orgId: string,
    printRunId: string,
  ): Promise<CaptureSessionContextModel> {
    const [row] = await tx
      .select({
        courseLabel: classGroups.name,
        instrumentName: instruments.name,
        sheetCount: sheetPrintRuns.sheetCount,
      })
      .from(sheetPrintRuns)
      .innerJoin(sheetLayouts, eq(sheetLayouts.id, sheetPrintRuns.layoutId))
      .innerJoin(instruments, eq(instruments.id, sheetLayouts.instrumentId))
      .leftJoin(classGroups, eq(classGroups.id, sheetPrintRuns.classGroupId))
      .where(and(eq(sheetPrintRuns.orgId, orgId), eq(sheetPrintRuns.id, printRunId)))
      .limit(1);
    if (!row) return { courseLabel: null, instrumentName: null, sheetCount: 0 };
    return {
      courseLabel: row.courseLabel ?? null,
      instrumentName: row.instrumentName,
      sheetCount: row.sheetCount,
    };
  }

  private async signCaptureToken(row: CaptureSession): Promise<string> {
    const key = await deriveCaptureTokenKey(this.config.getOrThrow<string>('AUTH_SECRET'));
    return new SignJWT({
      sessionId: row.id,
      orgId: row.orgId,
      printRunId: row.printRunId,
      batchId: row.batchId,
      scope: CAPTURE_SESSION_TOKEN_SCOPE,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(Math.floor(row.expiresAt.getTime() / 1000))
      .sign(key);
  }
}
