import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  instrumentSections,
  items,
  responses,
  sectionAttachments,
  withOrgContext,
} from '@soe/db';
import type { ItemInsightSnapshot } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { AssessmentReportService } from '../assessment-report/assessment-report.service';
import { ItemAnalysisService } from '../item-analysis/item-analysis.service';
import type { LlmImagePart } from '../llm/llm.types';
import { pointBiserial, type ScoreMatrix } from './ai-analysis.metrics';
import type {
  ItemInsightBuilder,
  ItemInsightBuildOptions,
  ItemInsightBuildResult,
} from './item-insight.port';

/** Tamaño máximo (bytes) de una imagen que se fetchea a base64 (best-effort). */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Timeout del fetch de cada imagen (ms): no debe colgar el ensamblado. */
const IMAGE_FETCH_TIMEOUT_MS = 8_000;

/**
 * Ensamblador del snapshot DETERMINISTA por-pregunta (F2 S2 — H20.8).
 *
 * Reúsa `ItemAnalysisService.getQuestionAnalysis` (scoping + tenancy + enunciado,
 * alternativas/distribución, distractor dominante, correctKey, tags, imageUrl) y
 * `AssessmentReportService.getReport` (psicometría p / D por ítem), añade
 * punto-biserial (matriz de aciertos), el pasaje de la sección y las imágenes
 * fetcheadas a base64 (best-effort, solo URLs http(s)).
 *
 * Multi-tenancy: el `orgId` proviene del token (`user.orgId`); toda query a tablas
 * con RLS corre dentro de `withOrgContext`. El snapshot NUNCA contiene PII de
 * alumnos: solo agregados + el contenido del ítem.
 */
@Injectable()
export class ItemInsightSnapshotService implements ItemInsightBuilder {
  private readonly logger = new Logger(ItemInsightSnapshotService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly itemAnalysis: ItemAnalysisService,
    private readonly reportService: AssessmentReportService,
  ) {}

  async build(
    user: JwtPayload,
    itemId: string,
    opts: ItemInsightBuildOptions,
  ): Promise<ItemInsightBuildResult> {
    const orgId = this.requireOrgId(user);

    // 1) Análisis determinista de la pregunta (valida scope/tenancy del caller).
    const question = await this.itemAnalysis.getQuestionAnalysis(user, itemId, {
      assessmentId: opts.assessmentId,
      classGroupId: opts.classGroupId,
    });

    // 2) Psicometría del informe (p, D, contentName) — busca el ítem por position.
    const report = await this.reportService.getReport(user, {
      assessmentId: opts.assessmentId,
      classGroupId: opts.classGroupId,
    });
    const reportItem = report.items.find((it) => it.itemId === itemId) ?? null;

    // 3) Datos no expuestos por los servicios anteriores: sección/pasaje, imagen
    //    del ítem y matriz de aciertos (para punto-biserial). Todo bajo RLS.
    const { passage, itemImageUrl, sectionImages, pb } = await withOrgContext(
      this.db,
      orgId,
      async (tx) => {
        const meta = await this.loadItemMeta(tx, itemId);
        const passage = meta?.sectionId
          ? await this.loadPassage(tx, meta.sectionId)
          : null;
        const sectionImages = meta?.sectionId
          ? await this.loadSectionImages(tx, meta.sectionId)
          : [];
        const pb = await this.computePointBiserial(
          tx,
          opts.assessmentId,
          meta?.instrumentId ?? null,
          itemId,
        );
        return {
          passage,
          itemImageUrl: question.imageUrl ?? meta?.imageUrl ?? null,
          sectionImages,
          pb,
        };
      },
    );

    // 4) Imágenes a base64 (best-effort): item + sección. Solo URLs http(s).
    const { snapshotImages, llmImages } = await this.fetchImages(
      itemImageUrl,
      sectionImages,
    );

    const difficulty =
      reportItem?.difficulty === null || reportItem?.difficulty === undefined
        ? null
        : reportItem.difficulty / 100; // % → 0..1

    const snapshot: ItemInsightSnapshot = {
      itemId: question.itemId,
      position: question.position,
      assessmentId: opts.assessmentId,
      instrumentName: report.meta.instrumentName ?? null,
      type: question.type,
      stem: question.stem,
      correctKey: question.correctKey,
      alternatives: question.alternatives.map((alt) => ({
        key: alt.key,
        text: alt.text,
        isCorrect: alt.isCorrect,
        count: alt.count,
        percentage: alt.percentage,
      })),
      totalResponses: question.totalResponses,
      blankCount: question.blankCount,
      correctRate: question.correctRate,
      difficulty,
      discrimination: reportItem?.discrimination ?? null,
      pointBiserial: pb,
      dominantDistractor: this.deriveDominantDistractor(question),
      skillName: question.skill?.nodeName ?? null,
      contentName: question.content?.nodeName ?? reportItem?.contentName ?? null,
      tags: question.tags.map((t) => ({
        nodeName: t.nodeName,
        nodeType: t.nodeType,
        nodeCode: t.nodeCode,
      })),
      passage,
      images: snapshotImages,
    };

    return { snapshot, images: llmImages };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Derivaciones puras
  // ───────────────────────────────────────────────────────────────────────────

  /** Alternativa INCORRECTA más elegida (distractor dominante); null si no hay. */
  private deriveDominantDistractor(
    question: Awaited<ReturnType<ItemAnalysisService['getQuestionAnalysis']>>,
  ): string | null {
    let best: { key: string; count: number } | null = null;
    for (const alt of question.alternatives) {
      if (alt.isCorrect) continue;
      if (alt.count <= 0) continue;
      if (!best || alt.count > best.count) {
        best = { key: alt.key, count: alt.count };
      }
    }
    return best?.key ?? null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Queries (dentro de withOrgContext)
  // ───────────────────────────────────────────────────────────────────────────

  /** Metadatos del ítem: instrumento, sección e imagen del contenido. */
  private async loadItemMeta(
    tx: Database,
    itemId: string,
  ): Promise<{
    instrumentId: string | null;
    sectionId: string | null;
    imageUrl: string | null;
  } | null> {
    const [row] = await tx
      .select({
        instrumentId: items.instrumentId,
        sectionId: items.sectionId,
        content: items.content,
      })
      .from(items)
      .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
      .limit(1);
    if (!row) return null;
    return {
      instrumentId: row.instrumentId ?? null,
      sectionId: row.sectionId ?? null,
      imageUrl: extractImageUrl(row.content),
    };
  }

  /** Pasaje (texto base) de la sección del ítem; null si la sección no tiene. */
  private async loadPassage(
    tx: Database,
    sectionId: string,
  ): Promise<ItemInsightSnapshot['passage']> {
    const [row] = await tx
      .select({
        passageTitle: instrumentSections.passageTitle,
        passageText: instrumentSections.passageText,
        passageFormat: sql<string | null>`${instrumentSections.passageFormat}::text`,
      })
      .from(instrumentSections)
      .where(eq(instrumentSections.id, sectionId))
      .limit(1);
    if (!row) return null;
    if (!row.passageTitle && !row.passageText) return null;
    return {
      title: row.passageTitle ?? null,
      text: row.passageText ?? null,
      format: row.passageFormat ?? null,
    };
  }

  /**
   * Imágenes adjuntas a la sección con URL http(s) fetcheable. Si solo hay
   * `storageKey` S3 sin `url`, se omiten (no hay downloader S3 en F2).
   */
  private async loadSectionImages(
    tx: Database,
    sectionId: string,
  ): Promise<Array<{ url: string; mimeType: string | null; note: string | null }>> {
    const rows = await tx
      .select({
        url: sectionAttachments.url,
        mimeType: sectionAttachments.mimeType,
        note: sectionAttachments.note,
        kind: sql<string>`${sectionAttachments.kind}::text`,
      })
      .from(sectionAttachments)
      .where(eq(sectionAttachments.sectionId, sectionId))
      .orderBy(asc(sectionAttachments.order));

    return rows
      .filter((r): r is typeof r & { url: string } => isHttpUrl(r.url))
      .map((r) => ({ url: r.url, mimeType: r.mimeType, note: r.note }));
  }

  /**
   * Punto-biserial del ítem en la cohorte de la evaluación. Construye la matriz
   * de aciertos (alumno × ítem) sobre TODOS los ítems del instrumento y aplica la
   * función pura. Sin PII: los ids de alumno solo agrupan y se descartan.
   */
  private async computePointBiserial(
    tx: Database,
    assessmentId: string,
    instrumentId: string | null,
    itemId: string,
  ): Promise<number | null> {
    if (!instrumentId) return null;

    const itemRows = await tx
      .select({ itemId: items.id })
      .from(items)
      .where(
        and(eq(items.instrumentId, instrumentId), isNull(items.deletedAt)),
      )
      .orderBy(asc(items.position));
    const itemOrder = itemRows.map((r) => r.itemId);
    const targetIndex = itemOrder.indexOf(itemId);
    if (targetIndex < 0 || itemOrder.length < 2) return null;

    const respRows = await tx
      .select({
        studentId: responses.studentId,
        itemId: responses.itemId,
        isCorrect: sql<boolean>`coalesce(${responses.isCorrect}, false)`,
      })
      .from(responses)
      .where(
        and(
          eq(responses.assessmentId, assessmentId),
          inArray(responses.itemId, itemOrder),
        ),
      );

    const itemIndex = new Map(itemOrder.map((id, idx) => [id, idx]));
    const byStudent = new Map<string, boolean[]>();
    for (const r of respRows) {
      const idx = itemIndex.get(r.itemId);
      if (idx === undefined) continue;
      let row = byStudent.get(r.studentId);
      if (!row) {
        row = new Array<boolean>(itemOrder.length).fill(false);
        byStudent.set(r.studentId, row);
      }
      row[idx] = r.isCorrect === true;
    }

    const matrix: ScoreMatrix = Array.from(byStudent.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, row]) => row);

    return pointBiserial(matrix, targetIndex);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Imágenes (fetch → base64, best-effort)
  // ───────────────────────────────────────────────────────────────────────────

  private async fetchImages(
    itemImageUrl: string | null,
    sectionImages: Array<{ url: string; mimeType: string | null; note: string | null }>,
  ): Promise<{
    snapshotImages: ItemInsightSnapshot['images'];
    llmImages: LlmImagePart[];
  }> {
    const sources: Array<{
      url: string;
      note: string | null;
      source: 'item' | 'section';
    }> = [];
    if (isHttpUrl(itemImageUrl)) {
      sources.push({ url: itemImageUrl, note: null, source: 'item' });
    }
    for (const img of sectionImages) {
      sources.push({ url: img.url, note: img.note, source: 'section' });
    }

    const results = await Promise.all(
      sources.map(async (s) => {
        const fetched = await this.fetchAsBase64(s.url);
        if (!fetched) return null;
        return { ...s, ...fetched };
      }),
    );

    const snapshotImages: ItemInsightSnapshot['images'] = [];
    const llmImages: LlmImagePart[] = [];
    for (const r of results) {
      if (!r) continue;
      snapshotImages.push({
        url: r.url,
        mimeType: r.mimeType,
        note: r.note,
        source: r.source,
      });
      llmImages.push({ mimeType: r.mimeType, data: r.data });
    }
    return { snapshotImages, llmImages };
  }

  /**
   * Descarga una URL http(s) y la devuelve como base64 (best-effort). Devuelve
   * null si falla, excede el tamaño máximo o el content-type no es imagen — el
   * análisis sigue en modo texto. No lanza: nunca debe tumbar el ensamblado.
   */
  private async fetchAsBase64(
    url: string,
  ): Promise<{ data: string; mimeType: string } | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type');
      if (contentType && !contentType.startsWith('image/')) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
        return null;
      }
      const mimeType = contentType?.split(';')[0]?.trim() || 'image/png';
      return { data: buffer.toString('base64'), mimeType };
    } catch (err) {
      this.logger.warn(
        `No se pudo descargar la imagen ${url}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  private requireOrgId(user: JwtPayload): string {
    if (!user.orgId) {
      throw new Error(
        'Sin organización activa. Selecciona una organización antes de continuar.',
      );
    }
    return user.orgId;
  }
}

/** `true` si la url es http(s) (fetcheable). Excluye claves S3 puras. */
function isHttpUrl(url: string | null): url is string {
  if (!url) return false;
  return /^https?:\/\//i.test(url);
}

/** Extrae `content.imageUrl` de forma defensiva (contenido polimórfico). */
function extractImageUrl(content: unknown): string | null {
  if (!content || typeof content !== 'object') return null;
  const url = (content as { imageUrl?: unknown }).imageUrl;
  return typeof url === 'string' && url.length > 0 ? url : null;
}
