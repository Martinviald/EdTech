import type { JSX } from 'react';
import type { AiBudgetStatus, AiBudgetAlertLevel } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatUsd, formatPct } from './format';

// ─────────────────────────────────────────────────────────────────────────────
// H19.25 — Barra de presupuesto mensual. Coloreada por `alertLevel`:
// ok (verde) < 80% · warning (ámbar) 80-100% · over (rojo) > 100%. Si no hay tope
// configurado, se muestra sólo el gasto del mes sin barra.
// ─────────────────────────────────────────────────────────────────────────────

const BAR_CLASS: Record<AiBudgetAlertLevel, string> = {
  ok: 'bg-success',
  warning: 'bg-warning',
  over: 'bg-destructive',
};

const ALERT_LABEL: Record<AiBudgetAlertLevel, string> = {
  ok: 'Dentro del presupuesto',
  warning: 'Cerca del límite',
  over: 'Presupuesto excedido',
};

const ALERT_TEXT_CLASS: Record<AiBudgetAlertLevel, string> = {
  ok: 'text-success',
  warning: 'text-warning',
  over: 'text-destructive',
};

export function BudgetBar({ budget }: { budget: AiBudgetStatus }): JSX.Element {
  const hasBudget = budget.budgetUsd !== null;
  // Ancho visual de la barra (clampeado a 100% aunque pctUsed > 100).
  const fillPct = budget.pctUsed === null ? 0 : Math.min(budget.pctUsed, 100);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Presupuesto mensual ({budget.month})</CardTitle>
          <span className={cn('text-sm font-medium', ALERT_TEXT_CLASS[budget.alertLevel])}>
            {ALERT_LABEL[budget.alertLevel]}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <span className="text-2xl font-semibold tabular-nums">
            {formatUsd(budget.monthSpendUsd)}
          </span>
          {hasBudget ? (
            <span className="text-muted-foreground">
              de {formatUsd(budget.budgetUsd as number)} · {formatPct(budget.pctUsed)} usado
            </span>
          ) : (
            <span className="text-muted-foreground">gastado este mes (sin tope configurado)</span>
          )}
        </div>

        {hasBudget ? (
          <div
            className="h-3 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={budget.pctUsed ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Porcentaje de presupuesto IA usado"
          >
            <div
              className={cn('h-full rounded-full transition-[width] motion-reduce:transition-none', BAR_CLASS[budget.alertLevel])}
              style={{ width: `${fillPct}%` }}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
