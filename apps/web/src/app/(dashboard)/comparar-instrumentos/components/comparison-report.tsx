'use client';

import { ArrowDownRight, ArrowRight, ArrowUpRight, Info } from 'lucide-react';
import type {
  ComparableAssessment,
  ComparisonDirection,
  ComparisonLikelihood,
  InstrumentComparisonOutput,
} from '@soe/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCallout } from '@/components/shared';

interface ComparisonReportProps {
  output: InstrumentComparisonOutput;
  base: ComparableAssessment;
  comparison: ComparableAssessment;
  model: string | null;
}

const DIRECTION_META: Record<
  ComparisonDirection,
  { label: string; icon: typeof ArrowRight; className: string }
> = {
  improved: {
    label: 'Mejoró',
    icon: ArrowUpRight,
    className: 'text-success',
  },
  declined: { label: 'Bajó', icon: ArrowDownRight, className: 'text-destructive' },
  stable: { label: 'Estable', icon: ArrowRight, className: 'text-muted-foreground' },
};

const LIKELIHOOD_LABEL: Record<ComparisonLikelihood, string> = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};

function sideLabel(a: ComparableAssessment): string {
  const year = a.year ? ` ${a.year}` : '';
  return `${a.instrumentName}${year}`;
}

function fmtPct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 10) / 10}%`;
}

function fmtDelta(value: number | null): string {
  if (value === null) return '—';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded} pts`;
}

/**
 * Render del diagnóstico IA de variación entre dos instrumentos comparables.
 * La IA PROPONE hipótesis: el disclaimer deja claro que es una hipótesis a validar.
 */
export function ComparisonReport({ output, base, comparison, model }: ComparisonReportProps) {
  const dir = DIRECTION_META[output.overallVariation.direction];
  const DirIcon = dir.icon;

  return (
    <div className="space-y-6">
      <AlertCallout tone="info">
        <span className="font-medium">Hipótesis generada por IA.</span> Este diagnóstico es una
        propuesta a partir del contenido y los resultados de ambos instrumentos, no una conclusión
        definitiva. Contrástalo con tu conocimiento del contexto antes de tomar decisiones.
      </AlertCallout>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{output.headline}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">Base: </span>
              <span className="font-medium">{sideLabel(base)}</span>{' '}
              <span className="tabular-nums">
                {fmtPct(output.overallVariation.baseAchievement)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Comparado: </span>
              <span className="font-medium">{sideLabel(comparison)}</span>{' '}
              <span className="tabular-nums">
                {fmtPct(output.overallVariation.comparisonAchievement)}
              </span>
            </div>
            <div className={`flex items-center gap-1 font-medium ${dir.className}`}>
              <DirIcon className="size-4" aria-hidden />
              {dir.label} · {fmtDelta(output.overallVariation.deltaPct)}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{output.overallVariation.magnitude}</p>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Hipótesis de la variación</h2>
        <div className="grid gap-3">
          {output.hypotheses.map((h, i) => (
            <Card key={i}>
              <CardContent className="space-y-2 pt-6">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium">{h.hypothesis}</p>
                  <Badge variant="secondary" className="shrink-0">
                    Probabilidad: {LIKELIHOOD_LABEL[h.likelihood]}
                  </Badge>
                </div>
                {h.supportingEvidence.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {h.supportingEvidence.map((e, j) => (
                      <li key={j}>{e}</li>
                    ))}
                  </ul>
                ) : null}
                {h.relatedSkills.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {h.relatedSkills.map((s, j) => (
                      <Badge key={j} variant="outline">
                        {s}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {output.contentDifferences.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Diferencias de contenido</h2>
          <div className="grid gap-3">
            {output.contentDifferences.map((c, i) => (
              <Card key={i}>
                <CardContent className="space-y-1 pt-6">
                  <p className="text-sm font-medium">{c.aspect}</p>
                  <p className="text-sm text-muted-foreground">{c.description}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">Evidencia:</span> {c.evidence}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {output.skillMovements.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Movimiento por habilidad</h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-3 font-medium">Habilidad</th>
                  <th className="p-3 text-right font-medium">Base</th>
                  <th className="p-3 text-right font-medium">Comparado</th>
                  <th className="p-3 text-right font-medium">Δ</th>
                  <th className="p-3 font-medium">Interpretación</th>
                </tr>
              </thead>
              <tbody>
                {output.skillMovements.map((s, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-3 font-medium">{s.nodeName}</td>
                    <td className="p-3 text-right tabular-nums">{fmtPct(s.baseAchievement)}</td>
                    <td className="p-3 text-right tabular-nums">
                      {fmtPct(s.comparisonAchievement)}
                    </td>
                    <td className="p-3 text-right tabular-nums">{fmtDelta(s.deltaPct)}</td>
                    <td className="p-3 text-muted-foreground">{s.interpretation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {output.recommendations.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Recomendaciones</h2>
          <div className="grid gap-3">
            {output.recommendations.map((r, i) => (
              <Card key={i}>
                <CardContent className="space-y-2 pt-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{r.title}</span>
                    <Badge variant="outline">
                      {r.audience === 'director' ? 'Directivo' : 'Profesor'}
                    </Badge>
                    <Badge variant="secondary">Prioridad: {r.priority}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{r.rationale}</p>
                  {r.suggestedActions.length > 0 ? (
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {r.suggestedActions.map((a, j) => (
                        <li key={j}>{a}</li>
                      ))}
                    </ul>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <Card>
        <CardContent className="space-y-2 pt-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 text-foreground">
            <Info className="size-4" aria-hidden />
            <span className="font-medium">
              Confianza del análisis: {Math.round(output.confidence * 100)}%
            </span>
          </div>
          {output.caveats.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5">
              {output.caveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : null}
          {model ? <p className="text-xs">Modelo: {model}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
