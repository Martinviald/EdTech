'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { RefreshCw } from 'lucide-react';
import type { AssessmentComparisonCandidate, AssessmentOption } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCallout } from '@/components/shared/AlertCallout';
import { EmptyState } from '@/components/shared/EmptyState';
import { Field } from '@/components/shared/Field';
import { TopProgressBar } from '@/components/shared/TopProgressBar';
import { ROUTES } from '@/lib/routes';
import { candidateDetail, formatDate } from './comparison-format';

type ComparisonSelectorProps =
  | {
      mode: 'comparison';
      base: AssessmentComparisonCandidate;
      candidates: AssessmentComparisonCandidate[];
      comparisonId: string | null;
    }
  | {
      mode: 'base';
      baseOptions: AssessmentOption[];
      baseNotFound: boolean;
    };

function baseOptionLabel(option: AssessmentOption): string {
  return [
    option.name ?? option.instrumentName,
    [option.subjectName, option.gradeName].filter(Boolean).join(' · ') || null,
    formatDate(option.administeredAt),
  ]
    .filter(Boolean)
    .join(' — ');
}

export function ComparisonSelector(props: ComparisonSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const navigate = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    startTransition(() =>
      router.push(
        (qs ? `${ROUTES.compararInstrumentos}?${qs}` : ROUTES.compararInstrumentos) as Route,
      ),
    );
  };

  if (props.mode === 'base') {
    if (props.baseOptions.length === 0) {
      return (
        <EmptyState
          title="No hay evaluaciones con resultados"
          description="Para comparar necesitas al menos dos evaluaciones con resultados de instrumentos comparables (mismo tipo, grado y asignatura)."
        />
      );
    }
    return (
      <Card hover={false} className="relative">
        <TopProgressBar active={isPending} />
        <CardContent className="space-y-4 pt-6">
          {props.baseNotFound ? (
            <AlertCallout tone="warning">
              No encontramos la evaluación base o está fuera de tu alcance. Elige otra.
            </AlertCallout>
          ) : null}
          <Field label="Evaluación base (referencia)">
            <Select
              onValueChange={(value) =>
                navigate({ baseId: value, comparisonId: null, cohort: null })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona la evaluación que quieres comparar" />
              </SelectTrigger>
              <SelectContent>
                {props.baseOptions.map((option) => (
                  <SelectItem key={option.assessmentId} value={option.assessmentId}>
                    {baseOptionLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>
    );
  }

  const { base, candidates, comparisonId } = props;

  return (
    <Card hover={false} className="relative">
      <TopProgressBar active={isPending} />
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-muted-foreground">Evaluación base</p>
            <p className="truncate font-medium">{base.assessmentName}</p>
            <p className="text-sm text-muted-foreground">
              {candidateDetail(base)} · {base.studentsAssessed} evaluados
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-2"
            disabled={isPending}
            onClick={() => navigate({ baseId: null, comparisonId: null, cohort: null })}
          >
            <RefreshCw className="size-4" aria-hidden />
            Cambiar base
          </Button>
        </div>

        {candidates.length === 0 ? (
          <AlertCallout tone="warning">
            No hay otra evaluación comparable con «{base.assessmentName}» (mismo tipo, grado y
            asignatura) con resultados en tus cursos.
          </AlertCallout>
        ) : (
          <Field label="Comparar con">
            <Select
              value={comparisonId ?? undefined}
              onValueChange={(value) => navigate({ comparisonId: value })}
              disabled={isPending}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona una evaluación comparable" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((candidate) => (
                  <SelectItem key={candidate.assessmentId} value={candidate.assessmentId}>
                    {candidate.assessmentName} — {candidateDetail(candidate)} (
                    {candidate.studentsAssessed} evaluados)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </CardContent>
    </Card>
  );
}
