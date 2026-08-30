import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  aiGradingJobs,
  items,
  printedSheets,
  responses,
  sheetScanMarks,
  sheetScans,
  withOrgContext,
} from '@soe/db';
import type { ItemContent, ItemType, LayoutSpec, LlmFeature, RubricLevel } from '@soe/types';
import {
  buildPrintedLabelIndex,
  resolveScanLabel,
  type ResolvableItem,
} from '../answer-sheets/lib/composite-answers';
import { InjectDb, type Database } from '../database/database.types';
import { FilesService } from '../files/files.service';
import { JOB_DISPATCHER, type JobDispatcher } from '../jobs/job-dispatcher';
import { estimateLlmCostUsd } from '../llm/llm.pricing';
import { LlmService } from '../llm/llm.service';
import type { LlmImagePart } from '../llm/llm.types';

export const DEVELOPMENT_GRADING_JOB_TYPE = 'development_crop';
export const DEVELOPMENT_GRADING_PROMPT_VERSION = 'dev-grading-v1';
export const DEVELOPMENT_GRADING_BATCH_LIMIT = 200;
const DEVELOPMENT_GRADING_LLM_FEATURE = 'ai_grading' satisfies LlmFeature;

export interface ScheduleConfirmedBatchParams {
  orgId: string;
  batchId: string;
  assessmentId: string;
  instrumentId: string;
  spec: LayoutSpec;
}

interface GradableItem extends ResolvableItem {
  id: string;
  maxScore: number;
}

interface GradingWork {
  jobId: string;
  responseId: string;
  markId: string;
  cropFileId: string;
  printedNumber: string;
  item: GradableItem;
}

const gradedOutputSchema = z.object({
  score: z.number().finite(),
  confidence: z.number().min(0).max(1).nullish(),
  justification: z.string().nullish(),
});

interface GradedOutput {
  score: number;
  confidence: number | null;
  justification: string | null;
}

@Injectable()
export class DevelopmentGradingService {
  private readonly logger = new Logger(DevelopmentGradingService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    @Inject(JOB_DISPATCHER) private readonly dispatcher: JobDispatcher,
    private readonly llm: LlmService,
    private readonly filesService: FilesService,
  ) {}

  scheduleConfirmedBatch(params: ScheduleConfirmedBatchParams): void {
    const cropFieldIds = params.spec.fields
      .filter((field) => field.kind === 'crop_region')
      .map((field) => field.fieldId);
    if (cropFieldIds.length === 0) return;

    this.dispatcher.enqueue({
      id: params.batchId,
      kind: 'development_grading',
      run: () => this.processConfirmedBatch(params, cropFieldIds),
    });
  }

  async processConfirmedBatch(
    params: ScheduleConfirmedBatchParams,
    cropFieldIds: string[],
  ): Promise<void> {
    const work = await this.createGradingJobs(params, cropFieldIds);
    for (const entry of work) {
      await this.gradeCrop(params.orgId, entry);
    }
  }

  private async createGradingJobs(
    params: ScheduleConfirmedBatchParams,
    cropFieldIds: string[],
  ): Promise<GradingWork[]> {
    return withOrgContext(this.db, params.orgId, async (tx) => {
      const cropRows = await tx
        .select({
          markId: sheetScanMarks.id,
          printedNumber: sheetScanMarks.printedNumber,
          cropFileId: sheetScanMarks.cropFileId,
          sequence: printedSheets.sequence,
          resolvedStudentId: sheetScans.resolvedStudentId,
          sheetStudentId: printedSheets.studentId,
        })
        .from(sheetScanMarks)
        .innerJoin(sheetScans, eq(sheetScans.id, sheetScanMarks.scanId))
        .leftJoin(printedSheets, eq(printedSheets.id, sheetScans.printedSheetId))
        .where(
          and(
            eq(sheetScanMarks.orgId, params.orgId),
            eq(sheetScans.batchId, params.batchId),
            notInArray(sheetScans.state, ['superseded', 'quality_rejected']),
            inArray(sheetScanMarks.fieldId, cropFieldIds),
          ),
        );
      if (cropRows.length === 0) return [];

      const itemRows = await tx
        .select({
          id: items.id,
          position: items.position,
          type: items.type,
          content: items.content,
          scoringConfig: items.scoringConfig,
        })
        .from(items)
        .where(and(eq(items.instrumentId, params.instrumentId), isNull(items.deletedAt)));

      const gradableItems: GradableItem[] = itemRows.map((row) => {
        const scoringConfig = (row.scoringConfig ?? {}) as {
          points?: number;
          printedNumber?: unknown;
        };
        return {
          id: row.id,
          position: row.position,
          type: row.type as ItemType,
          content: (row.content ?? {}) as ItemContent,
          printedNumber:
            typeof scoringConfig.printedNumber === 'string' ? scoringConfig.printedNumber : null,
          maxScore: scoringConfig.points ?? 1,
        };
      });
      const labelIndex = buildPrintedLabelIndex(gradableItems);

      const sortedCrops = [...cropRows].sort((a, b) => {
        const seqA = a.sequence ?? Number.MAX_SAFE_INTEGER;
        const seqB = b.sequence ?? Number.MAX_SAFE_INTEGER;
        if (seqA !== seqB) return seqA - seqB;
        return a.printedNumber.localeCompare(b.printedNumber);
      });

      const candidates: Array<Omit<GradingWork, 'jobId' | 'responseId'> & { studentId: string }> =
        [];
      for (const crop of sortedCrops) {
        const studentId = crop.resolvedStudentId ?? crop.sheetStudentId;
        if (!studentId || !crop.cropFileId) {
          this.logger.warn(
            `Recorte de la pregunta ${crop.printedNumber} sin ${studentId ? 'imagen' : 'alumno'} (lote ${params.batchId}): se salta`,
          );
          continue;
        }
        const resolved = resolveScanLabel(labelIndex, crop.printedNumber, null);
        if (resolved.kind !== 'item') {
          this.logger.warn(
            `El número impreso "${crop.printedNumber}" no corresponde a ningún ítem del instrumento (lote ${params.batchId}): se salta`,
          );
          continue;
        }
        candidates.push({
          markId: crop.markId,
          cropFileId: crop.cropFileId,
          printedNumber: crop.printedNumber,
          item: resolved.item as GradableItem,
          studentId,
        });
      }
      if (candidates.length === 0) return [];

      const studentIds = Array.from(new Set(candidates.map((c) => c.studentId)));
      const itemIds = Array.from(new Set(candidates.map((c) => c.item.id)));
      const responseRows = await tx
        .select({
          id: responses.id,
          studentId: responses.studentId,
          itemId: responses.itemId,
        })
        .from(responses)
        .where(
          and(
            eq(responses.assessmentId, params.assessmentId),
            inArray(responses.studentId, studentIds),
            inArray(responses.itemId, itemIds),
          ),
        );
      const responseIdByKey = new Map(
        responseRows.map((row) => [`${row.studentId}:${row.itemId}`, row.id]),
      );

      const responseIds = responseRows.map((row) => row.id);
      const alreadyEnqueued = new Set<string>();
      if (responseIds.length > 0) {
        const existingJobs = await tx
          .select({ responseId: aiGradingJobs.responseId, status: aiGradingJobs.status })
          .from(aiGradingJobs)
          .where(
            and(
              inArray(aiGradingJobs.responseId, responseIds),
              eq(aiGradingJobs.type, DEVELOPMENT_GRADING_JOB_TYPE),
            ),
          );
        for (const job of existingJobs) {
          if (job.status !== 'failed') alreadyEnqueued.add(job.responseId);
        }
      }

      const pending: Array<Omit<GradingWork, 'jobId'>> = [];
      for (const candidate of candidates) {
        const responseId = responseIdByKey.get(`${candidate.studentId}:${candidate.item.id}`);
        if (!responseId) {
          this.logger.warn(
            `No existe response para la pregunta ${candidate.printedNumber} del alumno ${candidate.studentId} (lote ${params.batchId}): se salta`,
          );
          continue;
        }
        if (alreadyEnqueued.has(responseId)) continue;
        alreadyEnqueued.add(responseId);
        pending.push({
          responseId,
          markId: candidate.markId,
          cropFileId: candidate.cropFileId,
          printedNumber: candidate.printedNumber,
          item: candidate.item,
        });
      }
      if (pending.length === 0) return [];

      const capped = pending.slice(0, DEVELOPMENT_GRADING_BATCH_LIMIT);
      if (pending.length > capped.length) {
        this.logger.warn(
          `Límite de ${DEVELOPMENT_GRADING_BATCH_LIMIT} correcciones por lote alcanzado: ${pending.length - capped.length} recorte(s) del lote ${params.batchId} quedan sin corrección automática`,
        );
      }

      const insertedJobs = await tx
        .insert(aiGradingJobs)
        .values(
          capped.map((entry) => ({
            responseId: entry.responseId,
            type: DEVELOPMENT_GRADING_JOB_TYPE,
            status: 'pending',
            promptVersion: DEVELOPMENT_GRADING_PROMPT_VERSION,
            input: {
              batchId: params.batchId,
              markId: entry.markId,
              cropFileId: entry.cropFileId,
              printedNumber: entry.printedNumber,
            },
          })),
        )
        .returning({ id: aiGradingJobs.id, responseId: aiGradingJobs.responseId });
      const jobIdByResponseId = new Map(insertedJobs.map((job) => [job.responseId, job.id]));

      const work: GradingWork[] = [];
      for (const entry of capped) {
        const jobId = jobIdByResponseId.get(entry.responseId);
        if (jobId) work.push({ ...entry, jobId });
      }
      return work;
    });
  }

  private async gradeCrop(orgId: string, work: GradingWork): Promise<void> {
    try {
      await this.updateJob(orgId, work.jobId, { status: 'processing' });
      const image = await this.loadCropImage(orgId, work.cropFileId);
      const completion = await this.llm.completeMultimodalWithUsage(
        this.buildSystem(),
        this.buildPrompt(work),
        [image],
        orgId,
        DEVELOPMENT_GRADING_LLM_FEATURE,
      );
      const graded = this.parseCompletion(completion.text, work.item.maxScore);

      await withOrgContext(this.db, orgId, async (tx) => {
        await tx
          .update(aiGradingJobs)
          .set({
            status: 'completed',
            model: completion.model,
            promptVersion: DEVELOPMENT_GRADING_PROMPT_VERSION,
            output: {
              score: graded.score,
              confidence: graded.confidence,
              justification: graded.justification,
            },
            score: graded.score.toFixed(2),
            confidence: graded.confidence !== null ? graded.confidence.toFixed(2) : null,
            justification: graded.justification,
            costUsd: estimateLlmCostUsd(completion.model, completion.usage),
            completedAt: new Date(),
          })
          .where(eq(aiGradingJobs.id, work.jobId));

        await tx
          .update(responses)
          .set({
            aiScore: {
              score: graded.score,
              ...(graded.confidence !== null ? { confidence: graded.confidence } : {}),
              ...(graded.justification !== null ? { justification: graded.justification } : {}),
              model: completion.model,
              promptVersion: DEVELOPMENT_GRADING_PROMPT_VERSION,
            },
            updatedAt: new Date(),
          })
          .where(eq(responses.id, work.responseId));
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Corrección de desarrollo falló (job ${work.jobId}, pregunta ${work.printedNumber}): ${message}`,
      );
      await this.updateJob(orgId, work.jobId, {
        status: 'failed',
        output: { error: message },
        completedAt: new Date(),
      });
    }
  }

  private async updateJob(
    orgId: string,
    jobId: string,
    values: Partial<typeof aiGradingJobs.$inferInsert>,
  ): Promise<void> {
    await withOrgContext(this.db, orgId, async (tx) => {
      await tx.update(aiGradingJobs).set(values).where(eq(aiGradingJobs.id, jobId));
    });
  }

  private async loadCropImage(orgId: string, cropFileId: string): Promise<LlmImagePart> {
    const record = await this.filesService.getById(orgId, cropFileId);
    const url = this.filesService.buildDownloadUrl(record, 'inline');
    if (!url) {
      throw new Error('El storage de archivos no está configurado: no se puede leer el recorte');
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`No se pudo descargar el recorte de la respuesta (HTTP ${response.status})`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      mimeType: record.mimeType ?? 'image/jpeg',
      data: buffer.toString('base64'),
    };
  }

  private buildSystem(): string {
    return [
      'Eres un profesor corrector experto en evaluaciones escolares chilenas.',
      'Corriges respuestas de desarrollo manuscritas a partir de la imagen del recorte, de forma justa y consistente con la pauta entregada.',
      'Tu corrección es una PROPUESTA que un docente revisará y podrá corregir: nunca es definitiva.',
    ].join(' ');
  }

  private buildPrompt(work: GradingWork): string {
    const statement = this.statementOf(work.item.content);
    const lines = [
      `Pregunta ${work.printedNumber}${statement ? `: ${statement}` : ''}`,
      `Puntaje máximo: ${work.item.maxScore}`,
    ];
    const rubric = this.rubricTextOf(work.item.content, work.item.maxScore);
    if (rubric) {
      lines.push('Pauta de corrección:', rubric);
    }
    lines.push(
      'La imagen adjunta es el recorte de la respuesta manuscrita del alumno. Si está en blanco o es ilegible, asigna puntaje 0 y explícalo.',
      `Responde SOLO un JSON con esta forma exacta: {"score": <número entre 0 y ${work.item.maxScore}>, "confidence": <número entre 0 y 1>, "justification": "<explicación breve en español>"}.`,
    );
    return lines.join('\n');
  }

  private statementOf(content: ItemContent): string | null {
    const raw = (content as { prompt?: unknown; passage?: unknown }).prompt;
    if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
    const passage = (content as { passage?: unknown }).passage;
    if (typeof passage === 'string' && passage.trim().length > 0) return passage.trim();
    return null;
  }

  private rubricTextOf(content: ItemContent, maxScore: number): string | null {
    const levels = (content as { levels?: RubricLevel[] }).levels;
    if (Array.isArray(levels) && levels.length > 0) {
      return levels
        .map((level) => {
          const label = level.label ? ` (${level.label})` : '';
          const descriptor = level.descriptor ? `: ${level.descriptor}` : '';
          const points = (level.creditFraction * maxScore).toFixed(2);
          return `- Nivel ${level.code}${label}${descriptor} → ${points} punto(s)`;
        })
        .join('\n');
    }
    const sampleAnswer = (content as { sampleAnswer?: unknown }).sampleAnswer;
    if (typeof sampleAnswer === 'string' && sampleAnswer.trim().length > 0) {
      return `Respuesta modelo esperada: ${sampleAnswer.trim()}`;
    }
    return null;
  }

  private parseCompletion(raw: string, maxScore: number): GradedOutput {
    let json: unknown;
    try {
      json = JSON.parse(this.stripCodeFences(raw));
    } catch {
      throw new Error('La salida del modelo no es JSON válido');
    }
    const parsed = gradedOutputSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error('La salida del modelo no cumple el contrato de corrección');
    }
    if (parsed.data.score < 0 || parsed.data.score > maxScore) {
      throw new Error(
        `La salida del modelo trae un puntaje fuera de rango (${parsed.data.score} de un máximo de ${maxScore})`,
      );
    }
    const justification = parsed.data.justification?.trim() ?? '';
    return {
      score: parsed.data.score,
      confidence: parsed.data.confidence ?? null,
      justification: justification.length > 0 ? justification : null,
    };
  }

  private stripCodeFences(raw: string): string {
    const trimmed = raw.trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
    return fenced?.[1] ?? trimmed;
  }
}
