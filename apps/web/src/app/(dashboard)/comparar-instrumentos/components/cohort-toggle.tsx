'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import type { AssessmentComparisonCohort } from '@soe/types';
import { Button } from '@/components/ui/button';
import { TopProgressBar } from '@/components/shared/TopProgressBar';
import { ROUTES } from '@/lib/routes';

const OPTIONS: { value: AssessmentComparisonCohort; label: string }[] = [
  { value: 'paired', label: 'Estudiantes pareados' },
  { value: 'all', label: 'Todos los evaluados' },
];

export function CohortToggle({ value }: { value: AssessmentComparisonCohort }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const select = (cohort: AssessmentComparisonCohort) => {
    if (cohort === value) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('cohort', cohort);
    startTransition(() =>
      router.push(`${ROUTES.compararInstrumentos}?${params.toString()}` as Route),
    );
  };

  return (
    <div
      role="group"
      aria-label="Cohorte de la comparación"
      className="relative inline-flex gap-1 rounded-lg border bg-muted/40 p-1"
    >
      <TopProgressBar active={isPending} />
      {OPTIONS.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={option.value === value ? 'secondary' : 'ghost'}
          aria-pressed={option.value === value}
          disabled={isPending}
          onClick={() => select(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
