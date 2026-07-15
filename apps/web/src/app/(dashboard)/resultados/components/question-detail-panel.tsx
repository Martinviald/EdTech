'use client';

import type { JSX } from 'react';
import { CheckCircle2, FileQuestion, Loader2 } from 'lucide-react';
import type {
  AlternativeDistribution,
  QuestionAnalysisResponse,
  QuestionSection,
  QuestionTaxonomyTag,
} from '@soe/types';
import { Badge } from '@/components/ui/badge';
import { hasPassageContent, type PassageData } from '@/components/passage-dialog';
import { cn } from '@/lib/utils';
import { QuestionDetailSheet } from '@/components/question-detail/question-detail-sheet';
import { QuestionNodes, type QuestionNodeTag } from '@/components/question-detail/question-nodes';

function questionSectionToPassage(section: QuestionSection): PassageData {
  return {
    sectionName: section.name,
    passageTitle: section.passageTitle,
    passageText: section.passageText,
    passageFormat: section.passageFormat,
    attachments: section.attachments.map((a) => ({
      kind: a.kind,
      url: a.url,
      fileName: a.fileName,
      mimeType: a.mimeType,
      note: a.note,
    })),
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
}): JSX.Element {
  const { data, open, onClose } = props;
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
        <QuestionDetailContent data={data} />
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

function QuestionDetailContent({ data }: { data: QuestionAnalysisResponse }): JSX.Element {
  const distractor = topDistractorKey(data.alternatives);

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

      {/* Todos los nodos de taxonomía asociados a la pregunta. TKT-05: en
          resultados los descriptores no se muestran (solo en el banco de ítems). */}
      <QuestionNodes tags={toNodeTags(data.tags)} hiddenTypes={['descriptor']} />

      {/* Distribución por alternativa */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Distribución de respuestas</h3>
        {data.alternatives.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
            <FileQuestion className="size-5" aria-hidden />
            <span>
              Esta pregunta no es de selección múltiple. Se registraron {data.totalResponses}{' '}
              respuestas con {formatPct(data.correctRate)} de logro.
            </span>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {data.alternatives.map((alt) => (
              <AlternativeRow key={alt.key} alt={alt} isTopDistractor={alt.key === distractor} />
            ))}
            {data.blankCount > 0 ? (
              <BlankRow count={data.blankCount} total={data.totalResponses} />
            ) : null}
          </ul>
        )}
      </section>
    </div>
  );
}

function AlternativeRow({
  alt,
  isTopDistractor,
}: {
  alt: AlternativeDistribution;
  isTopDistractor: boolean;
}): JSX.Element {
  const barClass = alt.isCorrect
    ? 'bg-emerald-500 dark:bg-emerald-600'
    : isTopDistractor
      ? 'bg-amber-500 dark:bg-amber-600'
      : 'bg-muted-foreground/40';

  return (
    <li className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
              alt.isCorrect
                ? 'border-emerald-500 text-emerald-700 dark:text-emerald-300'
                : 'border-border text-muted-foreground',
            )}
          >
            {alt.key}
          </span>
          <span className="truncate text-foreground">{alt.text ?? `Alternativa ${alt.key}`}</span>
          {alt.isCorrect ? (
            <CheckCircle2
              className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-label="Correcta"
            />
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
          className={cn('h-full rounded-full transition-all', barClass)}
          style={{ width: `${Math.min(100, Math.max(0, alt.percentage))}%` }}
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
          className="h-full rounded-full bg-muted-foreground/30 transition-all"
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
}: {
  label: string;
  value: string;
  tone: Tone;
}): JSX.Element {
  const toneClass: Record<Tone, string> = {
    good: 'text-emerald-700 dark:text-emerald-300',
    warning: 'text-amber-700 dark:text-amber-300',
    bad: 'text-red-700 dark:text-red-300',
    neutral: 'text-foreground',
  };
  return (
    <div className="rounded-lg border bg-card p-3 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-lg font-semibold tabular-nums', toneClass[tone])}>{value}</p>
    </div>
  );
}
