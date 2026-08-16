'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Cuerpo reutilizable del análisis IA por-pregunta: gatilla
// POST /api/ai-analysis/items/:itemId/generate, hace polling de GET /:id hasta
// completed/failed, valida el output con `itemInsightOutputSchema` y lo renderiza.
//
// Se usa embebido (Panel de resultados, con un botón "Analizar con IA") y dentro
// del modal `ItemInsightDialog` (con `autoStart`, que dispara la generación al
// abrir). El disclaimer de IA va SIEMPRE visible una vez iniciado.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import {
  itemInsightOutputSchema,
  type AiAnalysisStatus,
  type ItemInsightOutput,
  type UserRole,
} from '@soe/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCallout } from '@/components/shared';
import { causeLabel } from './format';
import { generateItemInsight, fetchItemInsight } from '../actions';

const POLL_INTERVAL_MS = 3000;

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; status: AiAnalysisStatus }
  | { kind: 'done'; output: ItemInsightOutput; model: string | null }
  | { kind: 'error'; message: string };

export interface ItemInsightInlineProps {
  itemId: string;
  assessmentId: string;
  classGroupId?: string;
  /** Rol activo, para enfocar la audiencia del análisis. Ausente → audiencia general. */
  activeRole?: UserRole;
  /** Si es true dispara la generación al montar (uso en modal). Si no, muestra un botón. */
  autoStart?: boolean;
}

function confidenceTone(confidence: number): 'success' | 'warning' | 'destructive' {
  if (confidence >= 0.7) return 'success';
  if (confidence >= 0.4) return 'warning';
  return 'destructive';
}

export function ItemInsightInline({
  itemId,
  assessmentId,
  classGroupId,
  activeRole,
  autoStart = false,
}: ItemInsightInlineProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const stopped = useRef(false);
  const audience: 'general' | 'director' | 'teacher' =
    activeRole === 'teacher' ? 'teacher' : activeRole == null ? 'general' : 'director';

  const run = useCallback(
    async (force: boolean) => {
      stopped.current = false;
      setPhase({ kind: 'running', status: 'pending' });
      try {
        const { analysisId } = await generateItemInsight({
          itemId,
          assessmentId,
          classGroupId,
          audience,
          force,
        });

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
            setPhase({ kind: 'done', output: parsed.data, model: analysis.model });
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
            err instanceof Error ? err.message : 'No se pudo generar el análisis de la pregunta.',
        });
      }
    },
    [itemId, assessmentId, classGroupId, audience],
  );

  useEffect(() => {
    if (autoStart) void run(false);
    return () => {
      stopped.current = true;
    };
  }, [autoStart, run]);

  return (
    <div className="space-y-4">
      {phase.kind !== 'idle' ? (
        <AlertCallout tone="warning" title="Sugerencia generada por IA — validar antes de actuar">
          Revisa cada conclusión con tu criterio pedagógico antes de tomar decisiones.
        </AlertCallout>
      ) : null}

      {phase.kind === 'idle' ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Genera una interpretación pedagógica de esta pregunta: causa probable del resultado,
            lectura de distractores o de la pauta, pasaje e imagen asociada, y acciones para
            mejorar.
          </p>
          <Button onClick={() => void run(false)}>
            <Sparkles className="size-4" aria-hidden />
            Analizar con IA
          </Button>
        </div>
      ) : null}

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
          : 'Interpretando la pregunta y sus resultados. Esto puede tomar algunos segundos.'}
      </p>
    </div>
  );
}

export function ItemInsightBody({
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
        <h3 className="text-base font-semibold text-foreground">{output.headline}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{output.performanceSummary}</p>
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
          <p className="mt-1 text-sm text-muted-foreground">{output.passageInsight}</p>
        </div>
      ) : null}

      {output.visualInsight ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Lectura de la imagen
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{output.visualInsight}</p>
        </div>
      ) : null}

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
