'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Entrada por UNIDAD COMPARABLE de la vista de trayectoria. Reemplaza el
// multi-select del panorama: un cascade guiado (eje → nivel → asignatura →
// medición → curso) que garantiza que el alcance sea siempre una familia
// comparable (N1/N2/N3), nunca una mezcla. Ver docs/diseno-comparacion-progresion.md.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import {
  COMPARABLE_TRAJECTORY_AXES,
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  type ComparableTrajectoryAxis,
  type DashboardFilterOptionsResponse,
  type InstrumentApplicationPeriod,
} from '@soe/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TopProgressBar } from '@/components/shared';
import { classGroupSelectOptions } from '../components/dashboard-filters';

const NONE = '__none__';

const AXIS_LABELS: Record<ComparableTrajectoryAxis, string> = {
  years: 'Años (generacional)',
  moments: 'Momentos del ciclo',
};

export type TrajectorySelection = {
  axis: ComparableTrajectoryAxis;
  gradeId?: string;
  subjectId?: string;
  instrumentType?: string;
  applicationPeriod?: InstrumentApplicationPeriod;
  classGroupId?: string;
};

type Instruments = DashboardFilterOptionsResponse['instruments'];

function instrumentsMatching(
  instruments: Instruments,
  sel: { gradeId?: string; subjectId?: string; type?: string },
): Instruments {
  return instruments.filter(
    (i) =>
      (!sel.gradeId || i.gradeId === sel.gradeId) &&
      (!sel.subjectId || i.subjectId === sel.subjectId) &&
      (!sel.type || i.type === sel.type),
  );
}

function uniqueBy<T, K>(items: T[], keyOf: (t: T) => K): T[] {
  const seen = new Set<K>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function TrajectoryScopeBar({
  options,
  basePath,
  selection,
}: {
  options: DashboardFilterOptionsResponse;
  basePath: string;
  selection: TrajectorySelection;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const pushParams = useCallback(
    (mutate: (sp: URLSearchParams) => void) => {
      const sp = new URLSearchParams(searchParams.toString());
      mutate(sp);
      const qs = sp.toString();
      startTransition(() => {
        router.push((qs ? `${basePath}?${qs}` : basePath) as Route);
      });
    },
    [router, searchParams, basePath],
  );

  const onAxis = useCallback(
    (next: string) => pushParams((sp) => sp.set('axis', next)),
    [pushParams],
  );

  const onGrade = useCallback(
    (next: string) =>
      pushParams((sp) => {
        sp.set('gradeId', next);
        // El nivel es la raíz del cascade: cambiarlo invalida todo lo de abajo.
        sp.delete('subjectId');
        sp.delete('instrumentType');
        sp.delete('applicationPeriod');
        sp.delete('classGroupId');
      }),
    [pushParams],
  );

  const onSubject = useCallback(
    (next: string) =>
      pushParams((sp) => {
        sp.set('subjectId', next);
        sp.delete('instrumentType');
        sp.delete('applicationPeriod');
      }),
    [pushParams],
  );

  const onType = useCallback(
    (next: string) =>
      pushParams((sp) => {
        sp.set('instrumentType', next);
        sp.delete('applicationPeriod');
      }),
    [pushParams],
  );

  const onPeriod = useCallback(
    (next: string) =>
      pushParams((sp) => {
        if (next === NONE) sp.delete('applicationPeriod');
        else sp.set('applicationPeriod', next);
      }),
    [pushParams],
  );

  const onCourse = useCallback(
    (next: string) =>
      pushParams((sp) => {
        if (next === NONE) sp.delete('classGroupId');
        else sp.set('classGroupId', next);
      }),
    [pushParams],
  );

  const gradeIds = new Set(options.instruments.map((i) => i.gradeId).filter(Boolean));
  const gradeOptions = options.grades.filter((g) => gradeIds.size === 0 || gradeIds.has(g.id));

  const subjectMatches = instrumentsMatching(options.instruments, { gradeId: selection.gradeId });
  const subjectIds = new Set(subjectMatches.map((i) => i.subjectId).filter(Boolean));
  const subjectOptions = options.subjects.filter((s) => subjectIds.has(s.id));

  const typeMatches = instrumentsMatching(options.instruments, {
    gradeId: selection.gradeId,
    subjectId: selection.subjectId,
  });
  const typeOptions = uniqueBy(
    typeMatches.map((i) => i.type),
    (t) => t,
  );

  const periodMatches = instrumentsMatching(options.instruments, {
    gradeId: selection.gradeId,
    subjectId: selection.subjectId,
    type: selection.instrumentType,
  });
  const periodOptions = uniqueBy(
    periodMatches
      .map((i) => i.applicationPeriod)
      .filter((p): p is InstrumentApplicationPeriod => !!p),
    (p) => p,
  );

  const courseOptions = classGroupSelectOptions(
    options.classGroups,
    options.grades,
    selection.gradeId,
  );

  const showPeriod = selection.axis === 'years' && periodOptions.length > 0;

  return (
    <div className="relative flex flex-col gap-3 overflow-hidden rounded-lg border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-end">
      <TopProgressBar active={isPending} position="bottom" />

      <Field label="Eje">
        <Select value={selection.axis} onValueChange={onAxis}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMPARABLE_TRAJECTORY_AXES.map((a) => (
              <SelectItem key={a} value={a}>
                {AXIS_LABELS[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Nivel">
        <Select value={selection.gradeId ?? ''} onValueChange={onGrade}>
          <SelectTrigger>
            <SelectValue placeholder="Elige un nivel" />
          </SelectTrigger>
          <SelectContent>
            {gradeOptions.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Asignatura">
        <Select
          value={selection.subjectId ?? ''}
          onValueChange={onSubject}
          disabled={!selection.gradeId || subjectOptions.length === 0}
        >
          <SelectTrigger>
            <SelectValue placeholder="Elige una asignatura" />
          </SelectTrigger>
          <SelectContent>
            {subjectOptions.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Medición">
        <Select
          value={selection.instrumentType ?? ''}
          onValueChange={onType}
          disabled={!selection.subjectId || typeOptions.length === 0}
        >
          <SelectTrigger>
            <SelectValue placeholder="Elige un instrumento" />
          </SelectTrigger>
          <SelectContent>
            {typeOptions.map((t) => (
              <SelectItem key={t} value={t}>
                {t.toUpperCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {showPeriod ? (
        <Field label="Momento">
          <Select value={selection.applicationPeriod ?? NONE} onValueChange={onPeriod}>
            <SelectTrigger>
              <SelectValue placeholder="Todos los momentos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Sin momento</SelectItem>
              {periodOptions.map((p) => (
                <SelectItem key={p} value={p}>
                  {INSTRUMENT_APPLICATION_PERIOD_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      <Field label="Curso (opcional)">
        <Select
          value={selection.classGroupId ?? NONE}
          onValueChange={onCourse}
          disabled={!selection.gradeId}
        >
          <SelectTrigger>
            <SelectValue placeholder="Todo el nivel" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Todo el nivel</SelectItem>
            {courseOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-[11rem] flex-1 flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
