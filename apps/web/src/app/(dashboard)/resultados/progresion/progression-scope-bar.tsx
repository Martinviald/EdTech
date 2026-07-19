'use client';

// ─────────────────────────────────────────────────────────────────────────────
// H6.6 — Barra de alcance (scope) de la progresión (FE-B). Permite elegir el
// tipo de entidad (alumno/curso/habilidad) y, para curso, el class_group desde
// las opciones del filtro. studentId/nodeId se controlan vía querystring (no hay
// catálogo de alumnos/habilidades en el contrato de filters).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import {
  PROGRESSION_SCOPES,
  type DashboardFilterOptionsResponse,
  type ProgressionScope,
} from '@soe/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { classGroupSelectOptions, isClassGroupInGrade } from '../components/dashboard-filters';

const SCOPE_LABELS: Record<ProgressionScope, string> = {
  student: 'Alumno',
  class: 'Curso',
  skill: 'Habilidad',
};

const NONE = '__none__';

export function ProgressionScopeBar(props: {
  options: DashboardFilterOptionsResponse;
  basePath: string;
  scope: ProgressionScope;
  studentId?: string;
  gradeId?: string;
  classGroupId?: string;
  nodeId?: string;
}) {
  const { options, basePath, scope, gradeId, classGroupId } = props;
  const router = useRouter();
  const searchParams = useSearchParams();

  const pushParams = useCallback(
    (mutate: (sp: URLSearchParams) => void) => {
      const sp = new URLSearchParams(searchParams.toString());
      mutate(sp);
      const qs = sp.toString();
      router.push((qs ? `${basePath}?${qs}` : basePath) as Route);
    },
    [router, searchParams, basePath],
  );

  const onScopeChange = useCallback(
    (next: string) => {
      pushParams((sp) => {
        sp.set('scope', next);
        // Limpiar selecciones de entidad de otros scopes para evitar inconsistencias.
        sp.delete('studentId');
        sp.delete('nodeId');
        if (next !== 'class') sp.delete('classGroupId');
      });
    },
    [pushParams],
  );

  // Al cambiar de nivel se descarta el curso elegido si ya no pertenece a él,
  // para no seguir consultando la progresión de un curso que salió del dropdown.
  const onGradeChange = useCallback(
    (next: string) => {
      const nextGrade = next === NONE ? null : next;
      const keepClass = isClassGroupInGrade(options.classGroups, classGroupId, nextGrade);
      pushParams((sp) => {
        if (nextGrade) sp.set('gradeId', nextGrade);
        else sp.delete('gradeId');
        if (!keepClass) sp.delete('classGroupId');
      });
    },
    [pushParams, options.classGroups, classGroupId],
  );

  const onClassChange = useCallback(
    (next: string) => {
      pushParams((sp) => {
        if (next === NONE) sp.delete('classGroupId');
        else sp.set('classGroupId', next);
      });
    },
    [pushParams],
  );

  // El nombre del curso ("A", "B") no dice de qué nivel es: el dropdown se acota
  // al nivel elegido y, sin nivel, muestra la etiqueta calificada ("3° Básico A").
  const courseOptions = classGroupSelectOptions(options.classGroups, options.grades, gradeId);

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">Alcance</label>
        <Select value={scope} onValueChange={onScopeChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROGRESSION_SCOPES.map((s) => (
              <SelectItem key={s} value={s}>
                {SCOPE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {scope === 'class' ? (
        <>
          <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Nivel / Grado</label>
            <Select value={gradeId ?? NONE} onValueChange={onGradeChange}>
              <SelectTrigger>
                <SelectValue placeholder="Todos los niveles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Todos los niveles</SelectItem>
                {options.grades.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex min-w-[14rem] flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Curso</label>
            <Select value={classGroupId ?? NONE} onValueChange={onClassChange}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un curso" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Selecciona un curso</SelectItem>
                {courseOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      ) : (
        <p className="flex-1 self-center text-xs text-muted-foreground">
          {scope === 'student'
            ? 'Indica el alumno mediante el parámetro studentId en la URL.'
            : 'Indica la habilidad mediante el parámetro nodeId en la URL.'}
        </p>
      )}
    </div>
  );
}
