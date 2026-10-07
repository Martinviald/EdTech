'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Lock, Sparkles } from 'lucide-react';
import {
  FEATURE_LABELS,
  instrumentComparisonOutputSchema,
  type AiAnalysisModel,
  type AiAnalysisStatus,
  type AssessmentComparisonCandidate,
  type InstrumentComparisonOutput,
} from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCallout } from '@/components/shared/AlertCallout';
import { Field } from '@/components/shared/Field';
import { getDisplayMessage } from '@/lib/errors';
import { pollInstrumentComparison, startInstrumentComparison } from '../actions';
import { ComparisonReport } from './comparison-report';

const POLL_INTERVAL_MS = 3000;

export type AiAudience = 'general' | 'director' | 'teacher';

const AUDIENCE_LABELS: Record<AiAudience, string> = {
  general: 'General',
  director: 'Directivo',
  teacher: 'Profesor',
};

interface AiComparisonPanelProps {
  base: AssessmentComparisonCandidate;
  comparison: AssessmentComparisonCandidate;
  featureEnabled: boolean;
  initialAudience: AiAudience;
}

export function AiComparisonPanel({
  base,
  comparison,
  featureEnabled,
  initialAudience,
}: AiComparisonPanelProps) {
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState<AiAudience>(initialAudience);
  const [isStarting, setIsStarting] = useState(false);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [status, setStatus] = useState<AiAnalysisStatus | null>(null);
  const [output, setOutput] = useState<InstrumentComparisonOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    if (!analysisId) return;
    stopped.current = false;

    async function tick() {
      try {
        const model: AiAnalysisModel = await pollInstrumentComparison(analysisId!);
        if (stopped.current) return;
        setStatus(model.status);
        if (model.status === 'completed') {
          const parsed = instrumentComparisonOutputSchema.safeParse(model.output);
          if (parsed.success) setOutput(parsed.data);
          else setError('El diagnóstico se generó pero no se pudo interpretar su formato.');
          return;
        }
        if (model.status === 'failed') {
          setError(model.error ?? 'El diagnóstico IA falló. Vuelve a intentarlo.');
          return;
        }
      } catch {
        // Error transitorio de red: reintenta en el siguiente intervalo.
      }
      if (!stopped.current) timer = window.setTimeout(tick, POLL_INTERVAL_MS);
    }

    let timer = window.setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      stopped.current = true;
      window.clearTimeout(timer);
    };
  }, [analysisId]);

  if (!featureEnabled) {
    return (
      <AlertCallout
        tone="info"
        icon={Lock}
        title={`${FEATURE_LABELS.ai_analysis} no está incluida en tu plan`}
      >
        La comparación con IA forma parte del plan avanzado. Conversa con tu administrador o con el
        equipo comercial para habilitarla en tu colegio.
      </AlertCallout>
    );
  }

  const sameInstrument = base.instrumentId === comparison.instrumentId;
  const isLoading = status === 'pending' || status === 'processing';

  async function handleGenerate(force: boolean) {
    setAnalysisId(null);
    setStatus(null);
    setOutput(null);
    setError(null);
    setIsStarting(true);
    try {
      const started = await startInstrumentComparison({
        baseAssessmentId: base.assessmentId,
        comparisonAssessmentId: comparison.assessmentId,
        audience,
        force,
      });
      setStatus(started.status);
      setAnalysisId(started.analysisId);
      setOpen(false);
    } catch (err) {
      setError(getDisplayMessage(err, 'No se pudo iniciar el diagnóstico.'));
      setOpen(false);
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-3">
        {sameInstrument ? (
          <p className="mr-auto text-sm text-muted-foreground">
            El diagnóstico con IA compara dos instrumentos distintos; estas evaluaciones usan el
            mismo.
          </p>
        ) : null}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" disabled={sameInstrument || isStarting || isLoading}>
              <Sparkles className="size-4" aria-hidden />
              Comparar con IA
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Comparar con IA</DialogTitle>
              <DialogDescription>
                La IA lee ambos instrumentos y sus ítems y propone hipótesis sobre la variación
                entre «{base.assessmentName}» y «{comparison.assessmentName}».
              </DialogDescription>
            </DialogHeader>
            <Field label="Enfoque del diagnóstico">
              <Select value={audience} onValueChange={(value) => setAudience(value as AiAudience)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(AUDIENCE_LABELS) as AiAudience[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {AUDIENCE_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <DialogFooter>
              <Button onClick={() => handleGenerate(false)} disabled={isStarting} className="gap-2">
                {isStarting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Generar diagnóstico
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {error ? (
        <AlertCallout tone="danger">
          {error}{' '}
          <button type="button" className="underline" onClick={() => handleGenerate(true)}>
            Reintentar
          </button>
        </AlertCallout>
      ) : null}

      {isLoading ? (
        <Card hover={false}>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
            <div className="space-y-1">
              <p className="text-base font-medium">Generando diagnóstico IA…</p>
              <p className="max-w-md text-sm text-muted-foreground">
                {status === 'pending'
                  ? 'El análisis está en cola. Mantén esta página abierta; se actualizará automáticamente.'
                  : 'La IA está contrastando el contenido y los resultados de ambos instrumentos. Esto puede tardar hasta un par de minutos.'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {output && !isLoading ? (
        <ComparisonReport output={output} base={base} comparison={comparison} model={null} />
      ) : null}
    </div>
  );
}
