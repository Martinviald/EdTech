'use client';

// ─────────────────────────────────────────────────────────────────────────────
// H7.5 — Barra de control del dashboard de benchmarking. Selector de instrumento,
// conmutador de modo (global anónimo ↔ red identificada) y filtros de cohorte
// (dependence/region/commune, solo modo global). Todo navega por URL (router.push):
// el Server Component de la página refetchea con los nuevos searchParams. No usa
// estado de fetch propio — la fuente de verdad es la querystring.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { Globe, Network } from 'lucide-react';
import type {
  BenchmarkInstrumentOption,
  BenchmarkMode,
} from '@soe/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/lib/routes';

const BASE_PATH = ROUTES.benchmarking;

/** Filtros de cohorte (texto libre) que solo aplican en modo global. */
const COHORT_FILTER_KEYS = ['dependence', 'region', 'commune'] as const;

/**
 * Clave de instrumento serializada en la URL: combina instrumentId + grade +
 * subject porque un mismo instrumento puede tener varias filas comparables.
 */
function optionKey(opt: BenchmarkInstrumentOption): string {
  return [opt.instrumentId, opt.gradeId ?? '', opt.subjectId ?? ''].join('|');
}

function optionLabel(opt: BenchmarkInstrumentOption): string {
  const parts = [opt.instrumentName];
  if (opt.gradeName) parts.push(opt.gradeName);
  if (opt.subjectName) parts.push(opt.subjectName);
  return parts.join(' · ');
}

export function BenchmarkToolbar({
  instruments,
  selectedKey,
  mode,
  cohort,
}: {
  instruments: BenchmarkInstrumentOption[];
  selectedKey: string | undefined;
  mode: BenchmarkMode;
  cohort: { dependence?: string; region?: string; commune?: string };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const navigate = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      const qs = params.toString();
      router.push(`${BASE_PATH}${qs ? `?${qs}` : ''}` as Route);
    },
    [router, searchParams],
  );

  const onSelectInstrument = useCallback(
    (key: string) => {
      const opt = instruments.find((i) => optionKey(i) === key);
      navigate((params) => {
        if (!opt) {
          params.delete('instrumentId');
          params.delete('gradeId');
          params.delete('subjectId');
          return;
        }
        params.set('instrumentId', opt.instrumentId);
        if (opt.gradeId) params.set('gradeId', opt.gradeId);
        else params.delete('gradeId');
        if (opt.subjectId) params.set('subjectId', opt.subjectId);
        else params.delete('subjectId');
      });
    },
    [instruments, navigate],
  );

  const onSetMode = useCallback(
    (next: BenchmarkMode) => {
      navigate((params) => {
        params.set('mode', next);
        // Los filtros de cohorte solo aplican en modo global: al pasar a red, se limpian.
        if (next === 'network') {
          for (const key of COHORT_FILTER_KEYS) params.delete(key);
        }
      });
    },
    [navigate],
  );

  const onSetCohort = useCallback(
    (key: (typeof COHORT_FILTER_KEYS)[number], value: string) => {
      navigate((params) => {
        const trimmed = value.trim();
        if (trimmed) params.set(key, trimmed);
        else params.delete(key);
      });
    },
    [navigate],
  );

  const hasCohortFilter = COHORT_FILTER_KEYS.some((k) => Boolean(cohort[k]));

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        {/* Selector de instrumento */}
        <div className="flex min-w-[220px] flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Instrumento a comparar
          </span>
          {instruments.length > 0 ? (
            <Select value={selectedKey ?? ''} onValueChange={onSelectInstrument}>
              <SelectTrigger className="w-full lg:w-[320px]">
                <SelectValue placeholder="Selecciona un instrumento" />
              </SelectTrigger>
              <SelectContent>
                {instruments.map((opt) => (
                  <SelectItem key={optionKey(opt)} value={optionKey(opt)}>
                    {optionLabel(opt)} ({opt.yourStudentCount}{' '}
                    {opt.yourStudentCount === 1 ? 'alumno' : 'alumnos'})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm text-muted-foreground">
              No hay instrumentos con datos para comparar.
            </p>
          )}
        </div>

        {/* Conmutador de modo */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Modo</span>
          <div
            role="tablist"
            aria-label="Modo de comparación"
            className="inline-flex rounded-md border bg-background p-1"
          >
            <ModeButton
              active={mode === 'global'}
              icon={Globe}
              label="Global anónimo"
              onClick={() => onSetMode('global')}
            />
            <ModeButton
              active={mode === 'network'}
              icon={Network}
              label="Red / sostenedor"
              onClick={() => onSetMode('network')}
            />
          </div>
        </div>
      </div>

      {/* Filtros de cohorte (solo modo global) */}
      {mode === 'global' ? (
        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:flex-wrap sm:items-end">
          <CohortInput
            label="Dependencia"
            placeholder="Ej: Municipal"
            defaultValue={cohort.dependence}
            onCommit={(v) => onSetCohort('dependence', v)}
          />
          <CohortInput
            label="Región"
            placeholder="Ej: Metropolitana"
            defaultValue={cohort.region}
            onCommit={(v) => onSetCohort('region', v)}
          />
          <CohortInput
            label="Comuna"
            placeholder="Ej: Providencia"
            defaultValue={cohort.commune}
            onCommit={(v) => onSetCohort('commune', v)}
          />
          {hasCohortFilter ? (
            <Button
              variant="ghost"
              size="sm"
              className="self-end"
              onClick={() =>
                navigate((params) => {
                  for (const key of COHORT_FILTER_KEYS) params.delete(key);
                })
              }
            >
              Limpiar filtros
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ModeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Globe;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  );
}

/**
 * Input de filtro de cohorte. Confirma con Enter o al perder el foco (blur),
 * evitando una navegación por cada tecla. La fuente de verdad sigue siendo la URL.
 */
function CohortInput({
  label,
  placeholder,
  defaultValue,
  onCommit,
}: {
  label: string;
  placeholder: string;
  defaultValue: string | undefined;
  onCommit: (value: string) => void;
}) {
  return (
    <div className="flex min-w-[160px] flex-1 flex-col gap-1 sm:flex-none">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Input
        type="text"
        placeholder={placeholder}
        defaultValue={defaultValue ?? ''}
        className="w-full sm:w-[180px]"
        onBlur={(e) => {
          if (e.target.value.trim() !== (defaultValue ?? '')) {
            onCommit(e.target.value);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onCommit(e.currentTarget.value);
          }
        }}
      />
    </div>
  );
}
