'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { GitCompareArrows, Loader2 } from 'lucide-react';
import {
  instrumentComparisonOutputSchema,
  type AiAnalysisModel,
  type AiAnalysisStatus,
  type ComparableAssessment,
  type InstrumentComparisonOutput,
} from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCallout, EmptyState, Field } from '@/components/shared';
import { pollInstrumentComparison, startInstrumentComparison } from '../actions';
import { ComparisonReport } from './comparison-report';

const POLL_INTERVAL_MS = 3000;

type Audience = 'general' | 'director' | 'teacher';

interface ComparisonWorkbenchProps {
  candidates: ComparableAssessment[];
}

function optionLabel(a: ComparableAssessment): string {
  const year = a.year ? ` · ${a.year}` : '';
  const evaluated = `${a.studentsEvaluated} evaluados`;
  return `${a.instrumentName}${year} (${evaluated})`;
}

function groupLabel(a: ComparableAssessment): string {
  const parts = [a.subjectName, a.gradeName].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : a.instrumentType;
}

/**
 * Flujo completo de TKT-23: seleccionar dos instrumentos comparables, disparar el
 * diagnóstico IA (async) y mostrar el resultado con estado de carga. Solo se pueden
 * comparar dos evaluaciones del mismo `comparableKey` (mismo tipo/grado/asignatura).
 */
export function ComparisonWorkbench({ candidates }: ComparisonWorkbenchProps) {
  const [baseId, setBaseId] = useState<string | null>(null);
  const [comparisonId, setComparisonId] = useState<string | null>(null);
  const [audience, setAudience] = useState<Audience>('general');
  const [isStarting, setIsStarting] = useState(false);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [status, setStatus] = useState<AiAnalysisStatus | null>(null);
  const [output, setOutput] = useState<InstrumentComparisonOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopped = useRef(false);

  const byId = useMemo(() => new Map(candidates.map((c) => [c.assessmentId, c])), [candidates]);

  const base = baseId ? (byId.get(baseId) ?? null) : null;

  // Solo son comparables las candidatas del mismo comparableKey que la base,
  // excluyendo la propia base.
  const comparisonOptions = useMemo(() => {
    if (!base) return [];
    return candidates.filter(
      (c) => c.comparableKey === base.comparableKey && c.assessmentId !== base.assessmentId,
    );
  }, [base, candidates]);

  const comparison = comparisonId ? (byId.get(comparisonId) ?? null) : null;
  const canGenerate = !!base && !!comparison && !isStarting;

  // Polling del estado del análisis mientras esté pending/processing.
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
          if (parsed.success) {
            setOutput(parsed.data);
          } else {
            setError('El diagnóstico se generó pero no se pudo interpretar su formato.');
          }
          return;
        }
        if (model.status === 'failed') {
          setError(model.error ?? 'El diagnóstico IA falló. Intenta nuevamente.');
          return;
        }
      } catch {
        // Error transitorio de red: reintenta en el siguiente intervalo.
      }
      if (!stopped.current) {
        timer = window.setTimeout(tick, POLL_INTERVAL_MS);
      }
    }

    let timer = window.setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      stopped.current = true;
      window.clearTimeout(timer);
    };
  }, [analysisId]);

  function resetResult() {
    setAnalysisId(null);
    setStatus(null);
    setOutput(null);
    setError(null);
  }

  async function handleGenerate(force = false) {
    if (!base || !comparison) return;
    resetResult();
    setIsStarting(true);
    try {
      const { analysisId: id, status: st } = await startInstrumentComparison({
        baseAssessmentId: base.assessmentId,
        comparisonAssessmentId: comparison.assessmentId,
        audience,
        force,
      });
      setStatus(st);
      setAnalysisId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar el diagnóstico.');
    } finally {
      setIsStarting(false);
    }
  }

  if (candidates.length < 2) {
    return (
      <EmptyState
        title="No hay suficientes evaluaciones con resultados"
        description="Necesitas al menos dos evaluaciones con resultados calculados y con instrumentos comparables (mismo tipo, grado y asignatura) para generar un diagnóstico."
      />
    );
  }

  const isLoading = status === 'pending' || status === 'processing';

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Instrumento base (referencia)">
              <Select
                value={baseId ?? undefined}
                onValueChange={(v) => {
                  setBaseId(v);
                  setComparisonId(null);
                  resetResult();
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona una evaluación" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((c) => (
                    <SelectItem key={c.assessmentId} value={c.assessmentId}>
                      {optionLabel(c)} — {groupLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Instrumento a comparar">
              <Select
                value={comparisonId ?? undefined}
                onValueChange={(v) => {
                  setComparisonId(v);
                  resetResult();
                }}
                disabled={!base}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      base ? 'Selecciona una evaluación comparable' : 'Elige primero la base'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {comparisonOptions.map((c) => (
                    <SelectItem key={c.assessmentId} value={c.assessmentId}>
                      {optionLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {base && comparisonOptions.length === 0 ? (
            <AlertCallout tone="warning">
              No hay otra evaluación comparable con «{base.instrumentName}» (mismo tipo, grado y
              asignatura). Selecciona otra base.
            </AlertCallout>
          ) : null}

          <div className="flex flex-wrap items-end justify-between gap-3">
            <Field label="Enfoque del diagnóstico" className="w-full max-w-xs">
              <Select value={audience} onValueChange={(v) => setAudience(v as Audience)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="director">Directivo</SelectItem>
                  <SelectItem value="teacher">Profesor</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Button onClick={() => handleGenerate(false)} disabled={!canGenerate}>
              {isStarting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <GitCompareArrows className="size-4" aria-hidden />
              )}
              Generar diagnóstico
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <AlertCallout tone="danger">
          {error}{' '}
          <button type="button" className="underline" onClick={() => handleGenerate(true)}>
            Reintentar
          </button>
        </AlertCallout>
      ) : null}

      {isLoading ? (
        <Card>
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

      {output && base && comparison && !isLoading ? (
        <ComparisonReport output={output} base={base} comparison={comparison} model={null} />
      ) : null}
    </div>
  );
}
