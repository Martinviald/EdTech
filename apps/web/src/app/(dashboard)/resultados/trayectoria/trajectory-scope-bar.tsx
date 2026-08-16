'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Entrada por UNIDAD COMPARABLE de la vista de trayectoria. Reemplaza el
// multi-select del panorama: nivel → asignatura → medición → curso, de modo que
// el alcance sea siempre una familia comparable (N1/N2/N3), nunca una mezcla.
//
// Cambiar un filtro NO borra los demás: se conserva todo lo que siga teniendo
// respaldo en el catálogo (`pruneTrajectoryScope`) y sólo cae lo que se quedó sin
// instrumentos. El curso es la excepción: pertenece a un nivel, así que cambiar
// de nivel lo suelta siempre.
//
// El momento del ciclo tampoco se filtra aquí: es el eje X del gráfico, que
// dibuja una línea por año sobre él. Ver docs/diseno-comparacion-progresion.md.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import {
  instrumentsInScope,
  pruneTrajectoryScope,
  type DashboardFilterOptionsResponse,
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

export type TrajectorySelection = {
  gradeId?: string;
  subjectId?: string;
  instrumentType?: string;
  classGroupId?: string;
};

function setOrDelete(sp: URLSearchParams, key: string, value: string | undefined): void {
  if (value) sp.set(key, value);
  else sp.delete(key);
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

  const instruments = options.instruments;

  const onGrade = useCallback(
    (next: string) => {
      const kept = pruneTrajectoryScope(instruments, {
        gradeId: next,
        subjectId: selection.subjectId,
        instrumentType: selection.instrumentType,
      });
      pushParams((sp) => {
        sp.set('gradeId', next);
        setOrDelete(sp, 'subjectId', kept.subjectId);
        setOrDelete(sp, 'instrumentType', kept.instrumentType);
        sp.delete('classGroupId');
      });
    },
    [instruments, pushParams, selection.subjectId, selection.instrumentType],
  );

  const onSubject = useCallback(
    (next: string) => {
      const kept = pruneTrajectoryScope(instruments, {
        gradeId: selection.gradeId,
        subjectId: next,
        instrumentType: selection.instrumentType,
      });
      pushParams((sp) => {
        sp.set('subjectId', next);
        setOrDelete(sp, 'instrumentType', kept.instrumentType);
      });
    },
    [instruments, pushParams, selection.gradeId, selection.instrumentType],
  );

  const onType = useCallback(
    (next: string) =>
      pushParams((sp) => {
        sp.set('instrumentType', next);
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

  const gradeIds = new Set(instruments.map((i) => i.gradeId).filter(Boolean));
  const gradeOptions = options.grades.filter((g) => gradeIds.size === 0 || gradeIds.has(g.id));

  const subjectMatches = instrumentsInScope(instruments, { gradeId: selection.gradeId });
  const subjectIds = new Set(subjectMatches.map((i) => i.subjectId).filter(Boolean));
  const subjectOptions = options.subjects.filter((s) => subjectIds.has(s.id));

  const typeMatches = instrumentsInScope(instruments, {
    gradeId: selection.gradeId,
    subjectId: selection.subjectId,
  });
  const typeOptions = Array.from(new Set(typeMatches.map((i) => i.type)));

  const courseOptions = classGroupSelectOptions(
    options.classGroups,
    options.grades,
    selection.gradeId,
  );

  return (
    <div className="relative flex flex-col gap-3 overflow-hidden rounded-lg border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-end">
      <TopProgressBar active={isPending} position="bottom" />

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
