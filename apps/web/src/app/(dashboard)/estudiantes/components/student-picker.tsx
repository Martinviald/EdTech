'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Search, UserRound } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { TopProgressBar } from '@/components/shared';
import { ROUTES } from '@/lib/routes';

export type PickerCourse = { id: string; label: string };
export type PickerStudent = {
  studentId: string;
  firstName: string;
  lastName: string;
  rut: string;
};

/**
 * Picker de alumno: seleccionar curso (Select) → buscar/elegir alumno del roster
 * de ese curso. Fuente = los cursos y su detalle visibles para el usuario (mismos
 * endpoints de `class-groups`, ya scoped por `teacher_assignments` en el backend).
 * NO se pega un UUID: el curso viaja por la URL (`?classGroupId=`) para que el
 * roster lo resuelva el Server Component; el alumno navega a su ficha 360.
 */
export function StudentPicker({
  courses,
  selectedClassGroupId,
  roster,
}: {
  courses: PickerCourse[];
  selectedClassGroupId: string | null;
  roster: PickerStudent[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [term, setTerm] = useState('');

  const onCourseChange = (value: string) => {
    startTransition(() => {
      const qs = value ? `?classGroupId=${value}` : '';
      router.push(`${ROUTES.estudiantes}${qs}` as Route);
    });
  };

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((s) => {
      const name = `${s.firstName} ${s.lastName}`.toLowerCase();
      return name.includes(q) || s.rut.toLowerCase().includes(q);
    });
  }, [roster, term]);

  return (
    <div className="relative space-y-4">
      <TopProgressBar active={isPending} />

      <div className="flex flex-col gap-2 sm:max-w-sm">
        <label className="text-sm font-medium text-muted-foreground">Curso</label>
        <Select value={selectedClassGroupId ?? ''} onValueChange={onCourseChange}>
          <SelectTrigger>
            <SelectValue placeholder="Selecciona un curso" />
          </SelectTrigger>
          <SelectContent>
            {courses.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedClassGroupId === null ? (
        <p className="text-sm text-muted-foreground">
          Elige un curso para ver su lista de estudiantes.
        </p>
      ) : roster.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Este curso no tiene estudiantes matriculados.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="relative sm:max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Buscar por nombre o RUT"
              className="pl-9"
              aria-label="Buscar estudiante"
            />
          </div>

          <ul className="divide-y divide-border rounded-lg border">
            {filtered.map((s) => (
              <li key={s.studentId}>
                <Link
                  href={ROUTES.estudiante(s.studentId)}
                  className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <UserRound className="size-4 text-muted-foreground" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {s.lastName}, {s.firstName}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{s.rut}</span>
                  </span>
                </Link>
              </li>
            ))}
            {filtered.length === 0 ? (
              <li className="px-4 py-3 text-sm text-muted-foreground">
                Sin coincidencias para “{term}”.
              </li>
            ) : null}
          </ul>
        </div>
      )}
    </div>
  );
}
