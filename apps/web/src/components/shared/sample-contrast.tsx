'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { ArrowDown, ArrowUp, ArrowRight, Equal } from 'lucide-react';
import {
  BENCHMARK_SAMPLE_EQUAL_PP,
  classifyTypicalZone,
  sampleDeltaPp,
  sampleSizeLabel,
  type InstrumentSampleEntry,
  type TypicalZone,
} from '@soe/types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTelemetry } from '@/lib/telemetry';
import { ROUTES } from '@/lib/routes';
import { cn } from '@/lib/utils';

/**
 * Contraste de un resultado con la muestra de colegios que rindieron el mismo
 * instrumento (docs/diseno-benchmarking-en-contexto.md §7). El chip lleva el Δ y su
 * tono sale de la ZONA TÍPICA (p25–p75), no del signo: −2 pp dentro de la zona no
 * es una alarma. El tooltip siempre dice cuántos colegios y alumnos hay detrás.
 */

export type SampleSubject = 'school' | 'course';

const ZONE_CLASS: Record<TypicalZone, string> = {
  below: 'bg-warning/15 text-warning',
  within: 'bg-muted text-muted-foreground',
  above: 'bg-success/10 text-success',
};

const ZONE_LABEL: Record<TypicalZone, string> = {
  below: 'Bajo la zona típica',
  within: 'En la zona típica',
  above: 'Sobre la zona típica',
};

const SUBJECT_LABEL: Record<SampleSubject, string> = {
  school: 'Tu colegio',
  course: 'Este curso',
};

function formatPct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

function formatPp(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(1)} pp`;
}

function formatCount(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatRefreshedAt(iso: string): string {
  return new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

export function sampleDetailHref(instrumentId: string): Route {
  return `${ROUTES.benchmarking}?instrumentId=${instrumentId}&mode=global` as Route;
}

/** Cuerpo del tooltip de la muestra. Lo comparten el chip y los gráficos con muestra. */
export function SampleTooltipBody({
  entry,
  value,
  subject = 'school',
  instrumentName,
  surface,
}: {
  entry: InstrumentSampleEntry;
  value: number | null;
  subject?: SampleSubject;
  instrumentName?: string;
  surface: string;
}) {
  const { track } = useTelemetry();
  const global = entry.global;
  if (!global) return null;
  const percentile = subject === 'school' ? (entry.you?.percentile ?? null) : null;

  return (
    <div className="max-w-xs space-y-2 py-1 text-xs">
      <div>
        <p className="font-semibold">Muestra{instrumentName ? ` · ${instrumentName}` : ''}</p>
        <p className="text-muted-foreground">
          Colegios que rindieron este mismo instrumento en la plataforma
        </p>
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 tabular-nums">
        <dt className="text-muted-foreground">% de logro de la muestra</dt>
        <dd className="text-right font-medium">{formatPct(global.avgAchievement)}</dd>
        <dt className="text-muted-foreground">Zona típica (p25–p75)</dt>
        <dd className="text-right font-medium">
          {formatPct(global.p25)} – {formatPct(global.p75)}
        </dd>
        <dt className="text-muted-foreground">{SUBJECT_LABEL[subject]}</dt>
        <dd className="text-right font-medium">
          {formatPct(value)}
          {percentile === null ? '' : ` · percentil ${Math.round(percentile)}`}
        </dd>
      </dl>
      <p className="text-muted-foreground">
        {sampleSizeLabel(global)} · actualizado {formatRefreshedAt(global.refreshedAt)}
      </p>
      {entry.network ? (
        <p className="text-muted-foreground">
          Tu red ({entry.network.label}):{' '}
          {formatCount(entry.network.schoolCount, 'colegio', 'colegios')} ·{' '}
          {formatPct(entry.network.avgAchievement)}
        </p>
      ) : null}
      <Link
        href={sampleDetailHref(entry.instrumentId)}
        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        onClick={() =>
          track('benchmark.sample_detail_opened', { surface, instrumentId: entry.instrumentId })
        }
      >
        Ver comparación <ArrowRight className="size-3" aria-hidden />
      </Link>
    </div>
  );
}

/**
 * Chip "▲ +4,0 pp vs muestra" junto a un % de logro. No dibuja nada si no hay
 * muestra válida (k-anonimato) o si el valor es nulo.
 */
export function SampleDeltaChip({
  entry,
  value,
  subject = 'school',
  instrumentName,
  surface,
  className,
}: {
  entry: InstrumentSampleEntry | null | undefined;
  value: number | null;
  subject?: SampleSubject;
  instrumentName?: string;
  surface: string;
  className?: string;
}) {
  const { track } = useTelemetry();
  const global = entry?.global;
  const delta = sampleDeltaPp(value, global?.avgAchievement ?? null);
  if (!entry || !global || delta === null) return null;

  const zone = classifyTypicalZone(value, global.p25, global.p75) ?? 'within';
  const isEqual = Math.abs(delta) < BENCHMARK_SAMPLE_EQUAL_PP;
  const Icon = isEqual ? Equal : delta > 0 ? ArrowUp : ArrowDown;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip
        onOpenChange={(open) => {
          if (open) track('benchmark.sample_viewed', { surface, instrumentId: entry.instrumentId });
        }}
      >
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums',
              ZONE_CLASS[zone],
              className,
            )}
            aria-label={`${ZONE_LABEL[zone]}: ${isEqual ? 'similar a la muestra' : `${formatPp(delta)} frente a la muestra`}`}
          >
            <Icon className="size-3 shrink-0" aria-hidden />
            {isEqual ? '≈ muestra' : `${formatPp(delta)} vs muestra`}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          <p className="mb-1 text-xs font-semibold">{ZONE_LABEL[zone]}</p>
          <SampleTooltipBody
            entry={entry}
            value={value}
            subject={subject}
            instrumentName={instrumentName}
            surface={surface}
          />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Una línea de la comparación: "Curso 58,1%", "Nivel 64,2%". `withDelta: false` muestra el valor
 * sin diferencia, cuando no está calculado sobre las mismas preguntas que la muestra.
 */
export type ComparisonLine = { label: string; value: number | null; withDelta?: boolean };

/** La muestra contra la que se compara, ya calculada para el grupo y sus preguntas (D9). */
export type ComparisonSample = {
  value: number | null;
  schoolCount: number;
  studentCount: number;
  refreshedAt?: string;
  /** Preguntas sobre las que se comparó, y cuántas tenía el grupo. */
  comparedItems?: number;
  totalItems?: number;
  percentile?: number | null;
  typicalZone?: TypicalZone | null;
};

/**
 * Bloque de tooltip "Curso · Nivel · Muestra" con la diferencia de cada línea contra la muestra
 * (docs/diseno-logro-unificado-y-cohorte.md §5). Lo comparten el tablero maestro, `/detalle` y
 * `/resultados`. Dice sobre cuántas preguntas se comparó cuando no son todas.
 */
export function SampleComparisonLines({
  lines,
  sample,
  instrumentId,
  surface,
}: {
  lines: readonly ComparisonLine[];
  sample: ComparisonSample;
  instrumentId?: string;
  surface: string;
}) {
  const { track } = useTelemetry();
  const missing =
    sample.comparedItems !== undefined && sample.totalItems !== undefined
      ? sample.totalItems - sample.comparedItems
      : 0;

  return (
    <div className="space-y-1.5 text-xs">
      <dl className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
        {lines.map((line) => {
          const delta = line.withDelta === false ? null : sampleDeltaPp(line.value, sample.value);
          return (
            <div key={line.label} className="contents">
              <dt className="text-muted-foreground">{line.label}</dt>
              <dd className="text-right font-medium">{formatPct(line.value)}</dd>
              <dd className="text-right text-muted-foreground">
                {delta === null ? '' : formatPp(delta)}
              </dd>
            </div>
          );
        })}
        <dt className="text-muted-foreground">Muestra</dt>
        <dd className="text-right font-medium">{formatPct(sample.value)}</dd>
        <dd />
      </dl>
      {sample.percentile != null ? (
        <p className="text-muted-foreground">
          Percentil {Math.round(sample.percentile)}
          {sample.typicalZone ? ` · ${ZONE_LABEL[sample.typicalZone].toLowerCase()}` : ''}
        </p>
      ) : null}
      {missing > 0 ? (
        <p className="text-muted-foreground">
          Comparado sobre {sample.comparedItems} de {sample.totalItems} preguntas:{' '}
          {formatCount(missing, 'sin corrección o sin muestra', 'sin corrección o sin muestra')}
        </p>
      ) : null}
      <p className="text-muted-foreground">
        {sampleSizeLabel(sample)}
        {sample.refreshedAt ? ` · actualizado ${formatRefreshedAt(sample.refreshedAt)}` : ''}
      </p>
      {instrumentId ? (
        <Link
          href={sampleDetailHref(instrumentId)}
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          onClick={() => track('benchmark.sample_detail_opened', { surface, instrumentId })}
        >
          Ver comparación <ArrowRight className="size-3" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}
