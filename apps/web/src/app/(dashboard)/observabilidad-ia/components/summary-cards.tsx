import type { JSX } from 'react';
import { DollarSign, ArrowDownToLine, ArrowUpFromLine, Timer, AlertTriangle } from 'lucide-react';
import type { AiObservabilitySummary } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatUsd, formatInt, formatLatency } from './format';

// ─────────────────────────────────────────────────────────────────────────────
// H19.25 — Tarjetas de totales: costo total, tokens in/out, latencia promedio y
// jobs fallidos del rango evaluado.
// ─────────────────────────────────────────────────────────────────────────────

interface SummaryCardsProps {
  totals: AiObservabilitySummary['totals'];
  from: string;
  to: string;
}

export function SummaryCards({ totals, from, to }: SummaryCardsProps): JSX.Element {
  const cards = [
    {
      label: 'Costo total',
      value: formatUsd(totals.totalCostUsd),
      icon: <DollarSign className="size-4" aria-hidden />,
    },
    {
      label: 'Tokens de entrada',
      value: formatInt(totals.inputTokens),
      icon: <ArrowDownToLine className="size-4" aria-hidden />,
    },
    {
      label: 'Tokens de salida',
      value: formatInt(totals.outputTokens),
      icon: <ArrowUpFromLine className="size-4" aria-hidden />,
    },
    {
      label: 'Latencia promedio',
      value: formatLatency(totals.avgLatencyMs),
      icon: <Timer className="size-4" aria-hidden />,
    },
    {
      label: 'Jobs fallidos',
      value: formatInt(totals.failedCount),
      icon: <AlertTriangle className="size-4" aria-hidden />,
      emphasis: totals.failedCount > 0,
    },
  ];

  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Rango: {from} a {to} · {formatInt(totals.count)} operación(es) de IA
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
              <span className="text-muted-foreground">{card.icon}</span>
            </CardHeader>
            <CardContent>
              <p
                className={
                  card.emphasis
                    ? 'text-2xl font-semibold tabular-nums text-red-600 dark:text-red-400'
                    : 'text-2xl font-semibold tabular-nums'
                }
              >
                {card.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
