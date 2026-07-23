'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Drill-down por-pregunta (H20.8). Modal `'use client'` que, para un ítem dado,
// gatilla POST /api/ai-analysis/items/:itemId/generate (server action), hace
// polling de GET /api/ai-analysis/:id hasta `completed`/`failed`, valida el
// `output` con `itemInsightOutputSchema` y lo renderiza. Muestra el enunciado, el
// pasaje y la imagen del ítem si están disponibles (provistos por el padre desde
// el endpoint determinista de item-analysis). Disclaimer IA siempre visible.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import {
  itemInsightOutputSchema,
  type AiAnalysisStatus,
  type ItemInsightOutput,
  type ItemInsightQualityVerdict,
  type UserRole,
} from '@soe/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCallout } from '@/components/shared';
import { causeLabel } from './format';
import { generateItemInsight, fetchItemInsight } from '../actions';

const POLL_INTERVAL_MS = 3000;

/** Datos mínimos del ítem para mostrar contexto (provistos por el padre). */
export interface ItemInsightTarget {
  itemId: string;
  position: number;
  skillName?: string | null;
  stem?: string | null;
  imageUrl?: string | null;
  passage?: { title: string | null; text: string | null } | null;
}

interface ItemInsightDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ItemInsightTarget | null;
  assessmentId: string;
  classGroupId?: string;
  activeRole: UserRole;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; status: AiAnalysisStatus }
  | { kind: 'done'; output: ItemInsightOutput; model: string | null }
  | { kind: 'error'; message: string };

const VERDICT_LABEL: Record<ItemInsightQualityVerdict, string> = {
  solid: 'Ítem sólido',
  review: 'Revisar ítem',
  flawed: 'Ítem defectuoso',
};

function verdictTone(
  verdict: ItemInsightQualityVerdict,
): 'success' | 'warning' | 'destructive' {
  if (verdict === 'solid') return 'success';
  if (verdict === 'review') return 'warning';
  return 'destructive';
}

function confidenceTone(
  confidence: number,
): 'success' | 'warning' | 'destructive' {
  if (confidence >= 0.7) return 'success';
  if (confidence >= 0.4) return 'warning';
  return 'destructive';
}

export function ItemInsightDialog({
  open,
  onOpenChange,
  target,
  assessmentId,
  classGroupId,
  activeRole,
}: ItemInsightDialogProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const stopped = useRef(false);
  const audience: 'director' | 'teacher' =
    activeRole === 'teacher' ? 'teacher' : 'director';

  const run = useCallback(
    async (force: boolean) => {
      if (!target) return;
      stopped.current = false;
      setPhase({ kind: 'running', status: 'pending' });
      try {
        const { analysisId } = await generateItemInsight({
          itemId: target.itemId,
          assessmentId,
          classGroupId,
          audience,
          force,
        });

        // Polling hasta completed/failed.
        const poll = async (): Promise<void> => {
          if (stopped.current) return;
          const analysis = await fetchItemInsight(analysisId);
          if (stopped.current) return;

          if (analysis.status === 'completed') {
            const parsed = itemInsightOutputSchema.safeParse(analysis.output);
            if (!parsed.success) {
              setPhase({
                kind: 'error',
                message:
                  'El análisis se completó pero tiene un formato inesperado. Intenta regenerarlo.',
              });
              return;
            }
            setPhase({
              kind: 'done',
              output: parsed.data,
              model: analysis.model,
            });
            return;
          }
          if (analysis.status === 'failed') {
            setPhase({
              kind: 'error',
              message:
                analysis.error ??
                'El análisis de la pregunta no pudo completarse. Intenta nuevamente.',
            });
            return;
          }
          setPhase({ kind: 'running', status: analysis.status });
          window.setTimeout(() => {
            void poll();
          }, POLL_INTERVAL_MS);
        };

        await poll();
      } catch (err) {
        if (stopped.current) return;
        setPhase({
          kind: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'No se pudo generar el análisis de la pregunta.',
        });
      }
    },
    [target, assessmentId, classGroupId, audience],
  );

  // Al abrir el modal con un target, dispara la generación. Al cerrar, detiene el
  // polling y limpia el estado.
  useEffect(() => {
    if (open && target) {
      void run(false);
    }
    return () => {
      stopped.current = true;
    };
  }, [open, target, run]);

  useEffect(() => {
    if (!open) setPhase({ kind: 'idle' });
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" aria-hidden />
            Análisis IA · Pregunta {target?.position ?? ''}
          </DialogTitle>
          <DialogDescription>
            {target?.skillName
              ? `Habilidad: ${target.skillName}`
              : 'Interpretación pedagógica de la pregunta a partir de métricas deterministas.'}
          </DialogDescription>
        </DialogHeader>

        {/* Contexto del ítem: enunciado, pasaje, imagen (si están). */}
        {target ? <ItemContext target={target} /> : null}

        {/* Disclaimer IA siempre visible. */}
        <AlertCallout
          tone="warning"
          title="Sugerencia generada por IA — validar antes de actuar"
        >
          Revisa cada conclusión con tu criterio pedagógico antes de tomar
          decisiones.
        </AlertCallout>

        {phase.kind === 'running' ? <RunningState status={phase.status} /> : null}

        {phase.kind === 'error' ? (
          <div className="space-y-3">
            <AlertCallout tone="danger" title="No se pudo generar el análisis">
              {phase.message}
            </AlertCallout>
            <Button variant="outline" onClick={() => void run(true)}>
              <RefreshCw className="size-4" aria-hidden />
              Reintentar
            </Button>
          </div>
        ) : null}

        {phase.kind === 'done' ? (
          <ItemInsightBody
            output={phase.output}
            model={phase.model}
            onRegenerate={() => void run(true)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ItemContext({ target }: { target: ItemInsightTarget }) {
  const hasContent = target.stem || target.passage?.text || target.imageUrl;
  if (!hasContent) return null;
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
      {target.stem ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Enunciado
          </p>
          <p className="mt-1 text-sm text-foreground">{target.stem}</p>
        </div>
      ) : null}
      {target.passage?.text ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {target.passage.title ?? 'Pasaje asociado'}
          </p>
          <p className="mt-1 line-clamp-6 whitespace-pre-line text-sm text-muted-foreground">
            {target.passage.text}
          </p>
        </div>
      ) : null}
      {target.imageUrl ? (
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ImageIcon className="size-3.5" aria-hidden />
            Imagen del ítem
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={target.imageUrl}
            alt={`Imagen de la pregunta ${target.position}`}
            className="max-h-48 w-full rounded-md border bg-background object-contain"
          />
        </div>
      ) : null}
    </div>
  );
}

function RunningState({ status }: { status: AiAnalysisStatus }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
      <p className="max-w-md text-sm text-muted-foreground">
        {status === 'pending'
          ? 'Análisis en cola. Mantén el panel abierto; se actualizará automáticamente.'
          : 'Interpretando la pregunta y sus distractores. Esto puede tomar algunos segundos.'}
      </p>
    </div>
  );
}

function ItemInsightBody({
  output,
  model,
  onRegenerate,
}: {
  output: ItemInsightOutput;
  model: string | null;
  onRegenerate: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Generado por IA</Badge>
        {model ? <Badge variant="outline">{model}</Badge> : null}
        <Badge variant="warning">{causeLabel(output.likelyCause)}</Badge>
        <Badge variant={confidenceTone(output.confidence)}>
          Confianza {Math.round(output.confidence * 100)}%
        </Badge>
      </div>

      <div>
        <h3 className="text-base font-semibold text-foreground">
          {output.headline}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {output.performanceSummary}
        </p>
      </div>

      {output.misconception ? (
        <div className="rounded-md bg-muted/40 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Misconcepción detectada
          </p>
          <p className="mt-1 text-sm text-foreground">{output.misconception}</p>
        </div>
      ) : null}

      {output.distractorAnalysis.length > 0 ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Lectura de distractores
          </p>
          <ul className="mt-2 space-y-2">
            {output.distractorAnalysis.map((d) => (
              <li key={d.key} className="flex gap-2 text-sm">
                <Badge variant="outline" className="h-fit shrink-0">
                  {d.key}
                </Badge>
                <span className="text-muted-foreground">{d.interpretation}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {output.passageInsight ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Lectura del pasaje
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {output.passageInsight}
          </p>
        </div>
      ) : null}

      {output.visualInsight ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Lectura de la imagen
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {output.visualInsight}
          </p>
        </div>
      ) : null}

      <div className="rounded-lg border p-3">
        <div className="flex items-center gap-2">
          <Badge variant={verdictTone(output.itemQuality.verdict)}>
            {VERDICT_LABEL[output.itemQuality.verdict]}
          </Badge>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Calidad del ítem
          </span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {output.itemQuality.notes}
        </p>
      </div>

      <div className="rounded-md bg-muted/40 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Acciones recomendadas
        </p>
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-foreground">
          {output.recommendedActions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </div>

      {output.caveats.length > 0 ? (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-warning">
            <AlertCircle className="size-3.5" aria-hidden />
            Límites del análisis
          </p>
          <ul className="mt-2 list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
            {output.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Button variant="outline" size="sm" onClick={onRegenerate}>
        <RefreshCw className="size-4" aria-hidden />
        Regenerar análisis
      </Button>
    </div>
  );
}
