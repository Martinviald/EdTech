'use client';

import { useCallback, useState, type JSX } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AssessmentReportItemRow, ItemReportFlag, QuestionAnalysisResponse } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { QuestionDetailPanel } from '../components/question-detail-panel';
import { fetchQuestionAnalysis } from '../detalle/actions';

// ─────────────────────────────────────────────────────────────────────────────
// T2-17 — Análisis de preguntas del informe, ahora CLICKEABLE. Cada fila abre el
// <QuestionDetailPanel> (enunciado, distribución de respuestas, distractores y
// referencias % colegio / % nivel), cargado bajo demanda por la misma Server
// Action `fetchQuestionAnalysis` que usa la tabla cruzada (H6.12). Se replica el
// patrón de apertura de `detalle/cross-table.tsx`: el padre mantiene el estado
// (open/detail/loadingItemId), llama la action y le pasa los datos al panel.
// ─────────────────────────────────────────────────────────────────────────────

// Umbrales de color para el % de logro. Mismos cortes que usa el backend para los
// flags, replicados aquí sólo para la codificación visual.
const ACHIEVEMENT_LOW = 40;
const ACHIEVEMENT_MID = 60;

const FLAG_META: Record<ItemReportFlag, { label: string; className: string }> = {
  critical: {
    label: 'Crítico',
    className: 'border-transparent bg-destructive/10 text-destructive',
  },
  dominant_error: {
    label: 'Error dominante',
    className: 'border-transparent bg-warning/15 text-warning',
  },
  high_achievement: {
    label: 'Logro alto',
    className: 'border-transparent bg-success/10 text-success',
  },
};

function achievementClass(value: number | null): string {
  if (value === null) return 'text-muted-foreground';
  if (value < ACHIEVEMENT_LOW) return 'text-destructive font-semibold';
  if (value < ACHIEVEMENT_MID) return 'text-warning font-medium';
  return 'text-success font-medium';
}

export function ItemsAnalysisTable({
  items,
  assessmentId,
  classGroupId,
}: {
  items: AssessmentReportItemRow[];
  // Cuando hay una evaluación (y opcionalmente un curso) en contexto, el panel
  // acota la distribución a esa población — igual que la tabla cruzada.
  assessmentId?: string;
  classGroupId?: string;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<QuestionAnalysisResponse | null>(null);
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null);

  const openQuestion = useCallback(
    async (item: AssessmentReportItemRow) => {
      setDetail(null);
      setOpen(true);
      setLoadingItemId(item.itemId);
      const result = await fetchQuestionAnalysis({
        itemId: item.itemId,
        assessmentId,
        classGroupId,
      });
      // Evita pisar el estado si el usuario ya cerró/abrió otra pregunta.
      setLoadingItemId((current) => {
        if (current !== item.itemId) return current;
        if (result.ok) {
          setDetail(result.data);
        } else {
          toast.error(result.message);
          setOpen(false);
        }
        return null;
      });
    },
    [assessmentId, classGroupId],
  );

  const closePanel = useCallback(() => {
    setOpen(false);
    setDetail(null);
    setLoadingItemId(null);
  }, []);

  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Análisis de preguntas</CardTitle>
        <p className="text-sm text-muted-foreground">
          % de logro de cada pregunta y alternativa incorrecta más elegida. «Error dominante» marca
          las preguntas donde el curso se fue en masa por la misma alternativa equivocada. Haz clic
          en una pregunta para ver su detalle.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">N°</TableHead>
                <TableHead>Habilidad / contenido</TableHead>
                <TableHead className="text-center">Clave</TableHead>
                <TableHead className="text-right">% de logro</TableHead>
                <TableHead className="hidden md:table-cell">Distractor top</TableHead>
                <TableHead>Alertas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i) => (
                <ItemRow
                  key={i.itemId}
                  item={i}
                  loading={loadingItemId === i.itemId}
                  onOpen={() => void openQuestion(i)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
        <FlagsLegend />
      </CardContent>

      <QuestionDetailPanel data={detail} open={open} onClose={closePanel} canAddToCollection />
    </Card>
  );
}

function ItemRow({
  item,
  loading,
  onOpen,
}: {
  item: AssessmentReportItemRow;
  loading: boolean;
  onOpen: () => void;
}): JSX.Element {
  const label = item.skillName ?? item.contentName ?? '—';
  const secondary = item.skillName && item.contentName ? item.contentName : null;
  return (
    <TableRow
      role="button"
      tabIndex={0}
      aria-label={`Ver el detalle de la pregunta ${item.position}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <TableCell className="font-medium">
        <span className="inline-flex items-center gap-1 tabular-nums">
          {item.position}
          {loading ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
        </span>
      </TableCell>
      <TableCell>
        <span className="block text-sm">{label}</span>
        {secondary ? (
          <span className="block text-xs text-muted-foreground">{secondary}</span>
        ) : null}
      </TableCell>
      <TableCell className="text-center font-mono text-xs">{item.correctKey ?? '—'}</TableCell>
      <TableCell className={cn('text-right tabular-nums', achievementClass(item.difficulty))}>
        {item.difficulty === null ? '—' : `${item.difficulty.toFixed(0)}%`}
      </TableCell>
      <TableCell className="hidden md:table-cell text-sm">
        {item.topDistractorKey ? (
          <span>
            <span className="font-mono">{item.topDistractorKey}</span>
            {item.topDistractorRate !== null ? (
              <span className="text-muted-foreground"> ({item.topDistractorRate.toFixed(0)}%)</span>
            ) : null}
          </span>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {item.flags.map((f) => (
            <span
              key={f}
              className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                FLAG_META[f].className,
              )}
            >
              {FLAG_META[f].label}
            </span>
          ))}
        </div>
      </TableCell>
    </TableRow>
  );
}

function FlagsLegend(): JSX.Element {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
      <span>
        <strong className="text-foreground">Crítico</strong>: &lt;40% de logro — contenido no
        logrado.
      </span>
      <span>
        <strong className="text-foreground">Error dominante</strong>: una alternativa incorrecta
        atrae más que la clave — misconcepción compartida por el curso.
      </span>
      <span>
        <strong className="text-foreground">Logro alto</strong>: ≥85% de logro.
      </span>
    </div>
  );
}
