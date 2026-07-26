import type { JSX } from 'react';
import { DollarSign, ArrowDownToLine, ArrowUpFromLine, Timer, AlertTriangle } from 'lucide-react';
import type { AiObservabilitySummary } from '@soe/types';
import { MetricsGroup, type Metric } from '@/components/shared';
import { formatUsd, formatInt, formatLatency } from './format';

// ─────────────────────────────────────────────────────────────────────────────
// H19.25 — Totales del rango: costo total, tokens in/out, latencia promedio y
// jobs fallidos (en rojo si hay). Se muestran agrupados en un `MetricsGroup`.
// ─────────────────────────────────────────────────────────────────────────────

interface SummaryCardsProps {
  totals: AiObservabilitySummary['totals'];
  from: string;
  to: string;
}

export function SummaryCards({ totals, from, to }: SummaryCardsProps): JSX.Element {
  const metrics: Metric[] = [
    { label: 'Costo total', value: formatUsd(totals.totalCostUsd), icon: DollarSign },
    { label: 'Tokens de entrada', value: formatInt(totals.inputTokens), icon: ArrowDownToLine },
    { label: 'Tokens de salida', value: formatInt(totals.outputTokens), icon: ArrowUpFromLine },
    { label: 'Latencia promedio', value: formatLatency(totals.avgLatencyMs), icon: Timer },
    {
      label: 'Jobs fallidos',
      value: formatInt(totals.failedCount),
      icon: AlertTriangle,
      tone: totals.failedCount > 0 ? 'danger' : 'default',
    },
  ];

  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Rango: {from} a {to} · {formatInt(totals.count)} operación(es) de IA
      </p>
      <MetricsGroup metrics={metrics} />
    </section>
  );
}
