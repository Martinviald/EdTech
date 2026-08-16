'use client';

import type { JSX } from 'react';
import { CheckCircle2, FileQuestion, Loader2, Sparkles } from 'lucide-react';
import type {
  AlternativeDistribution,
  QuestionAnalysisResponse,
  QuestionSection,
  QuestionTaxonomyTag,
  RawAnswerCount,
  ScoreCategoryDistribution,
  UserRole,
} from '@soe/types';
import { Badge } from '@/components/ui/badge';
import {
  hasPassageContent,
  toPassageAttachments,
  type PassageData,
} from '@/components/passage-dialog';
import { cn } from '@/lib/utils';
import { QuestionDetailSheet } from '@/components/question-detail/question-detail-sheet';
import { QuestionNodes, type QuestionNodeTag } from '@/components/question-detail/question-nodes';
import { AnswerKeyView } from '@/components/items/answer-key-view';
import { ItemInsightInline } from '@/app/(dashboard)/analisis-ia/components/item-insight-inline';
import { AddToCollectionMenu } from '@/components/collections/add-to-collection-menu';

function questionSectionToPassage(section: QuestionSection): PassageData {
  return {
    sectionName: section.name,
    passageTitle: section.passageTitle,
    passageText: section.passageText,
    passageFormat: section.passageFormat,
    attachments: toPassageAttachments(section.id, section.attachments),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// H6.12 — Panel de distribución de respuestas + análisis de distractores.
//
// Enfoque de datos: el panel es controlado por el padre (la tabla cruzada). El
// padre carga `QuestionAnalysisResponse` vía la Server Action
// `fetchQuestionAnalysis` (ver detalle/actions.ts) y se lo pasa por `data`. Si
// `data` es null mientras `open` está activo, mostramos un estado de carga.
// Así el panel no hace fetch propio: recibe los datos ya cargados (uno de los
// enfoques permitidos por el contrato, sección 3.3).
// ─────────────────────────────────────────────────────────────────────────────

function formatPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)}%`;
}

/** Identifica el distractor más elegido (alternativa incorrecta con más respuestas). */
function topDistractorKey(alternatives: AlternativeDistribution[]): string | null {
  let top: AlternativeDistribution | null = null;
  for (const alt of alternatives) {
    if (alt.isCorrect) continue;
    if (alt.count <= 0) continue;
    if (!top || alt.count > top.count) top = alt;
  }
  return top?.key ?? null;
}

export function QuestionDetailPanel(props: {
  data: QuestionAnalysisResponse | null;
  open: boolean;
  onClose: () => void;
  canAddToCollection?: boolean;
  /** Contexto para el análisis IA por-pregunta. Sin `assessmentId` no se ofrece. */
  assessmentId?: string;
  classGroupId?: string;
  activeRole?: UserRole;
}): JSX.Element {
  const {
    data,
    open,
    onClose,
    canAddToCollection = false,
    assessmentId,
    classGroupId,
    activeRole,
  } = props;
  const section = data?.section ?? null;
  const passage = section && hasPassageContent(section) ? questionSectionToPassage(section) : null;

  return (
    <QuestionDetailSheet
      open={open}
      onClose={onClose}
      position={data?.position ?? null}
      headerBadges={
        data?.correctKey ? <Badge variant="success">Clave correcta: {data.correctKey}</Badge> : null
      }
      headerActions={
        data && canAddToCollection ? <AddToCollectionMenu itemId={data.itemId} /> : undefined
      }
      description="Enunciado, distribución de respuestas, análisis de distractores y nodos asociados a la pregunta."
      passage={passage}
      figureItemId={data?.hasFigure ? data.itemId : null}
      storageKey="soe.questionDetail.panelWidth"
    >
      {data === null ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" aria-hidden />
          <p className="text-sm">Cargando análisis de la pregunta…</p>
        </div>
      ) : (
        <QuestionDetailContent
          data={data}
          assessmentId={assessmentId}
          classGroupId={classGroupId}
          activeRole={activeRole}
        />
      )}
    </QuestionDetailSheet>
  );
}

/** Normaliza los tags de la pregunta a la forma común de `QuestionNodes`. */
function toNodeTags(tags: QuestionTaxonomyTag[]): QuestionNodeTag[] {
  return tags.map((t) => ({
    nodeId: t.nodeId,
    code: t.nodeCode ?? null,
    type: t.nodeType,
    name: t.nodeName,
    taggedBy: t.taggedBy,
  }));
}

function QuestionDetailContent({
  data,
  assessmentId,
  classGroupId,
  activeRole,
}: {
  data: QuestionAnalysisResponse;
  assessmentId?: string;
  classGroupId?: string;
  activeRole?: UserRole;
}): JSX.Element {
  const distractor = topDistractorKey(data.alternatives);
  const levelReference = data.references.grade.rate;
  // En selección múltiple la clave ya va resaltada en la distribución; para el
  // resto de tipos (V/F, desarrollo, pauta…) la mostramos aparte.
  const showAnswerKey =
    data.answerKey.kind !== 'choice' &&
    data.answerKey.kind !== 'multi_choice' &&
    data.answerKey.kind !== 'none';

  return (
    <div className="mt-6 space-y-6">
      {/* Enunciado de la pregunta, prominente y etiquetado */}
      <section className="space-y-1.5">
        <h3 className="text-sm font-semibold text-foreground">Enunciado</h3>
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
          {data.stem ?? 'Esta pregunta no tiene enunciado registrado.'}
        </p>
        {data.explanation ? (
          <p className="text-xs text-muted-foreground">{data.explanation}</p>
        ) : null}
      </section>

      {data.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.imageUrl}
          alt={`Imagen de la pregunta ${data.position}`}
          className="max-h-64 w-full rounded-md border object-contain"
        />
      ) : null}

      {/* Respuesta correcta / pauta (para tipos sin alternativas visibles) */}
      {showAnswerKey ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Respuesta correcta</h3>
          <AnswerKeyView answerKey={data.answerKey} itemId={data.itemId} />
        </section>
      ) : null}

      {/* Métricas globales de la pregunta */}
      <div className="grid grid-cols-3 gap-3">
        <MetricCard
          label="% de logro"
          value={formatPct(data.correctRate)}
          tone={achievementTone(data.correctRate)}
        />
        <MetricCard label="Respuestas" value={String(data.totalResponses)} tone="neutral" />
        <MetricCard
          label="En blanco"
          value={String(data.blankCount)}
          tone={data.blankCount > 0 ? 'warning' : 'neutral'}
        />
      </div>

      {/* T2-17 — Comparativa: % de logro de la MISMA pregunta en el nivel/grado,
          junto al % del scope en contexto (arriba). El nivel trasciende el scope del
          usuario: un profesor ve su curso arriba y esta referencia más amplia aquí. */}
      {levelReference !== null ? (
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="% de logro · nivel"
            value={formatPct(levelReference)}
            tone={achievementTone(levelReference)}
            hint={`${data.references.grade.responseCount} respuestas`}
          />
        </div>
      ) : null}

      {/* Todos los nodos de taxonomía asociados a la pregunta. TKT-05: en
          resultados los descriptores no se muestran (solo en el banco de ítems). */}
      <QuestionNodes tags={toNodeTags(data.tags)} hiddenTypes={['descriptor']} />

      {/* Distribución: por alternativa (MC) o por categoría de puntaje (desarrollo) */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Distribución de respuestas</h3>
        {data.alternatives.length > 0 ? (
          <ul className="space-y-2.5">
            {data.alternatives.map((alt) => (
              <AlternativeRow
                key={alt.key}
                alt={alt}
                itemId={data.itemId}
                isTopDistractor={alt.key === distractor}
              />
            ))}
            {data.blankCount > 0 ? (
              <BlankRow count={data.blankCount} total={data.totalResponses} />
            ) : null}
          </ul>
        ) : data.scoreDistribution ? (
          <ul className="space-y-2.5">
            {data.scoreDistribution.map((category) => (
              <ScoreCategoryRow key={category.key} category={category} />
            ))}
            {data.blankCount > 0 ? (
              <BlankRow count={data.blankCount} total={data.totalResponses} />
            ) : null}
          </ul>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
            <FileQuestion className="size-5" aria-hidden />
            <span>
              Sin distribución disponible. Se registraron {data.totalResponses} respuestas con{' '}
              {formatPct(data.correctRate)} de logro.
            </span>
          </div>
        )}
      </section>

      {/* Respuestas exactas de los alumnos (tipos estructurados no-MC) */}
      {data.rawAnswerDistribution && data.rawAnswerDistribution.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Respuestas más frecuentes</h3>
          <p className="text-xs text-muted-foreground">
            Lo que escribieron exactamente los alumnos, agrupado por frecuencia. Las respuestas
            correctas van en verde.
          </p>
          <ul className="space-y-2.5">
            {data.rawAnswerDistribution.map((answer, i) => (
              <RawAnswerRow key={`${answer.answer}-${i}`} answer={answer} />
            ))}
          </ul>
        </section>
      ) : null}

      {/* Análisis pedagógico con IA (drill-down por-pregunta) */}
      {assessmentId ? (
        <section className="space-y-3 border-t pt-6">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="size-4 text-primary" aria-hidden />
            Análisis pedagógico con IA
          </h3>
          <ItemInsightInline
            key={data.itemId}
            itemId={data.itemId}
            assessmentId={assessmentId}
            classGroupId={classGroupId}
            activeRole={activeRole}
          />
        </section>
      ) : null}
    </div>
  );
}

function AlternativeRow({
  alt,
  itemId,
  isTopDistractor,
}: {
  alt: AlternativeDistribution;
  itemId: string;
  isTopDistractor: boolean;
}): JSX.Element {
  const barClass = alt.isCorrect
    ? 'bg-success'
    : isTopDistractor
      ? 'bg-warning'
      : 'bg-muted-foreground/40';

  return (
    <li className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
              alt.isCorrect ? 'border-success text-success' : 'border-border text-muted-foreground',
            )}
          >
            {alt.key}
          </span>
          {alt.hasImage ? (
            // La alternativa es una imagen: miniatura en vez del `text` (descripción de IA
            // que filtraría la respuesta). La descripción va sólo en `alt`.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/items/${itemId}/alternativa/${alt.key}/figura`}
              alt={alt.text ?? `Alternativa ${alt.key}`}
              className="max-h-12 min-w-0 rounded border bg-white object-contain"
            />
          ) : (
            <span className="truncate text-foreground">{alt.text ?? `Alternativa ${alt.key}`}</span>
          )}
          {alt.isCorrect ? (
            <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Correcta" />
          ) : isTopDistractor ? (
            <Badge variant="warning" className="shrink-0">
              Distractor
            </Badge>
          ) : null}
        </div>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {alt.count} · {formatPct(alt.percentage)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="presentation">
        <div
          className={cn(
            'h-full rounded-full transition-[width] motion-reduce:transition-none',
            barClass,
          )}
          style={{ width: `${Math.min(100, Math.max(0, alt.percentage))}%` }}
        />
      </div>
    </li>
  );
}

function ScoreCategoryRow({ category }: { category: ScoreCategoryDistribution }): JSX.Element {
  const barClass =
    category.credit >= 1 ? 'bg-success' : category.credit > 0 ? 'bg-warning' : 'bg-destructive/70';
  return (
    <li className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium text-foreground">{category.label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {category.count} · {formatPct(category.percentage)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="presentation">
        <div
          className={cn(
            'h-full rounded-full transition-[width] motion-reduce:transition-none',
            barClass,
          )}
          style={{ width: `${Math.min(100, Math.max(0, category.percentage))}%` }}
        />
      </div>
    </li>
  );
}

function RawAnswerRow({ answer }: { answer: RawAnswerCount }): JSX.Element {
  return (
    <li className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="flex min-w-0 items-center gap-2">
          {answer.isCorrect ? (
            <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Correcta" />
          ) : null}
          <span
            className={cn(
              'min-w-0 truncate',
              answer.isCorrect ? 'font-medium text-foreground' : 'text-foreground',
            )}
            title={answer.answer}
          >
            {answer.answer}
          </span>
        </div>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {answer.count} · {formatPct(answer.percentage)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="presentation">
        <div
          className={cn(
            'h-full rounded-full transition-[width] motion-reduce:transition-none',
            answer.isCorrect ? 'bg-success' : 'bg-muted-foreground/40',
          )}
          style={{ width: `${Math.min(100, Math.max(0, answer.percentage))}%` }}
        />
      </div>
    </li>
  );
}

function BlankRow({ count, total }: { count: number; total: number }): JSX.Element {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <li className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">Sin respuesta</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {count} · {formatPct(pct)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-muted-foreground/30 transition-[width] motion-reduce:transition-none"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </li>
  );
}

type Tone = 'good' | 'warning' | 'bad' | 'neutral';

function achievementTone(rate: number | null): Tone {
  if (rate === null) return 'neutral';
  if (rate >= 70) return 'good';
  if (rate >= 50) return 'warning';
  return 'bad';
}

function MetricCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: Tone;
  /** Detalle al pie (ej. el N de la población de una referencia). */
  hint?: string;
}): JSX.Element {
  const toneClass: Record<Tone, string> = {
    good: 'text-success',
    warning: 'text-warning',
    bad: 'text-destructive',
    neutral: 'text-foreground',
  };
  return (
    <div className="rounded-lg border bg-card p-3 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-lg font-semibold tabular-nums', toneClass[tone])}>{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
