'use client';

import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { OrgTeacher } from '@/lib/teacherAssignmentsApi';

/**
 * Selector de profesor con buscador.
 *
 * Reemplaza al `Select` porque un colegio con ~80 docentes vuelve inusable un dropdown
 * plano: había que reconocer a la persona por orden alfabético. Se busca por nombre O
 * por correo — el correo suele ser lo único que recuerda quien invita.
 *
 * No usa un combobox de librería (`cmdk`) a propósito: vive dentro de un modal, así que
 * no necesita popover ni portal, y evitamos sumar una dependencia de UI (CLAUDE.md §2).
 */

/** Sin tildes y en minúsculas: buscar "gonzalez" tiene que encontrar a "González". */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function TeacherPicker({
  teachers,
  value,
  onChange,
  disabled,
}: {
  teachers: OrgTeacher[];
  value: string;
  onChange: (teacherId: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = normalize(query.trim());
    const matches = q
      ? teachers.filter((t) => normalize(t.name).includes(q) || normalize(t.email).includes(q))
      : teachers;
    // Los que no se pueden asignar van al final: se listan para explicar por qué no
    // están disponibles, no para competir con los que sí sirven.
    return [...matches].sort(
      (a, b) => Number(b.assignable) - Number(a.assignable) || a.name.localeCompare(b.name),
    );
  }, [teachers, query]);

  const selected = teachers.find((t) => t.id === value) ?? null;

  return (
    <div className="space-y-2">
      <Label htmlFor="teacher-search">Profesor</Label>

      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
        <Input
          id="teacher-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre o correo…"
          disabled={disabled}
          autoComplete="off"
          className="pl-8"
        />
      </div>

      <div
        role="listbox"
        aria-label="Profesores"
        className="max-h-56 overflow-y-auto rounded-md border"
      >
        {results.length === 0 ? (
          <p className="text-muted-foreground p-3 text-sm">
            Ningún docente coincide con “{query}”.
          </p>
        ) : (
          results.map((t) => {
            const isSelected = t.id === value;
            return (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={disabled || !t.assignable}
                onClick={() => onChange(t.id)}
                className={cn(
                  'flex w-full items-start gap-2 border-b p-2 text-left text-sm last:border-b-0',
                  t.assignable
                    ? 'hover:bg-muted/60 cursor-pointer'
                    : 'cursor-not-allowed opacity-60',
                  isSelected && 'bg-muted',
                )}
              >
                <Check
                  className={cn('mt-0.5 size-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{t.name}</span>
                    {t.status === 'pending' ? (
                      <Badge variant="warning" className="text-[10px]">
                        Sin ingresar aún
                      </Badge>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">{t.email}</span>
                  {!t.assignable ? (
                    <span className="text-muted-foreground mt-0.5 block text-xs">
                      Invitación sin nombre registrado. Vuelve a invitarlo desde Equipo agregando su
                      nombre para poder asignarle carga.
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })
        )}
      </div>

      {selected ? (
        <p className="text-muted-foreground text-xs">
          Seleccionado: <span className="text-foreground font-medium">{selected.name}</span>
        </p>
      ) : null}
    </div>
  );
}
