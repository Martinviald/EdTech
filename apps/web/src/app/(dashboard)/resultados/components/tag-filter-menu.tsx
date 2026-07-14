'use client';

import { useMemo, type JSX } from 'react';
import { ListFilter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// ─────────────────────────────────────────────────────────────────────────────
// TKT-12 — Filtro multi-tag (lógica OR), reutilizable.
//
// Componente de PRESENTACIÓN puro: recibe las opciones disponibles, la selección
// actual y un `onChange`. No decide de dónde salen los tags ni cómo se aplican
// (client-side sobre una matriz ya cargada, o server-side vía `tagIds[]` en la
// querystring del banco global). Así se reutiliza tanto en la tabla cruzada de
// resultados (TKT-09/12) como en el banco de ítems global (TKT-14).
//
// Semántica OR: un elemento pasa el filtro si tiene CUALQUIERA de los tags
// seleccionados. Las opciones se agrupan por `group` (ej. "Habilidad",
// "Contenido", "Tipo de texto") preservando el orden de aparición.
// ─────────────────────────────────────────────────────────────────────────────

export type TagFilterOption = {
  id: string;
  label: string;
  /** Etiqueta del grupo (dimensión) al que pertenece el tag, ej. "Habilidad". */
  group?: string;
};

export function TagFilterMenu({
  options,
  selected,
  onChange,
  label = 'Filtrar por tag',
  emptyLabel = 'No hay tags para filtrar',
  align = 'start',
}: {
  options: TagFilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  label?: string;
  emptyLabel?: string;
  align?: 'start' | 'center' | 'end';
}): JSX.Element {
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Agrupa preservando el orden de aparición de cada grupo.
  const groups = useMemo(() => {
    const map = new Map<string, TagFilterOption[]>();
    for (const opt of options) {
      const key = opt.group ?? '';
      const list = map.get(key) ?? [];
      list.push(opt);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [options]);

  const toggle = (id: string): void => {
    if (selectedSet.has(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  const disabled = options.length === 0;
  const count = selected.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" disabled={disabled}>
          <ListFilter className="size-4" aria-hidden />
          {label}
          {count > 0 ? (
            <Badge variant="secondary" className="ml-0.5 h-5 min-w-5 justify-center px-1.5">
              {count}
            </Badge>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="max-h-[22rem] w-64 overflow-y-auto">
        {disabled ? (
          <DropdownMenuItem disabled>{emptyLabel}</DropdownMenuItem>
        ) : (
          <>
            {groups.map(([groupLabel, groupOptions], idx) => (
              <div key={groupLabel || `g-${idx}`}>
                {idx > 0 ? <DropdownMenuSeparator /> : null}
                {groupLabel ? (
                  <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
                    {groupLabel}
                  </DropdownMenuLabel>
                ) : null}
                {groupOptions.map((opt) => (
                  <DropdownMenuCheckboxItem
                    key={opt.id}
                    checked={selectedSet.has(opt.id)}
                    // Evita que el menú se cierre: permite selección múltiple.
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={() => toggle(opt.id)}
                  >
                    {opt.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </div>
            ))}
            {count > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    onChange([]);
                  }}
                  className="gap-2 text-muted-foreground"
                >
                  <X className="size-4" aria-hidden />
                  Limpiar filtro ({count})
                </DropdownMenuItem>
              </>
            ) : null}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
