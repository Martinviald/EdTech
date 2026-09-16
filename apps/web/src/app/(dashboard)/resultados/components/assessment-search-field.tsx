'use client';

import { useId } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * El control del buscador dentro de la barra de filtros: input con ícono, botón
 * de envío y una línea de ayuda que dice en qué estado está la búsqueda.
 *
 * Vive aparte de `DashboardFilterBar` porque ese archivo ya arma nueve campos y
 * este es el único que tiene estado propio y texto de ayuda.
 */
export function AssessmentSearchField({
  term,
  onTermChange,
  onSubmit,
  isDebouncing,
  isTooShort,
  minLength,
}: {
  term: string;
  onTermChange: (next: string) => void;
  onSubmit: () => void;
  isDebouncing: boolean;
  isTooShort: boolean;
  minLength: number;
}) {
  const hintId = useId();

  // Un lector de pantalla tiene que enterarse de que hay una búsqueda encolada:
  // durante la espera no cambia nada más en pantalla.
  const hint = isTooShort
    ? `Escribe al menos ${minLength} caracteres`
    : isDebouncing
      ? 'Se buscará en un momento — Enter para buscar ahora'
      : '';

  return (
    <form
      role="search"
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={term}
          onChange={(e) => onTermChange(e.target.value)}
          placeholder="Nombre de evaluación o instrumento"
          className="bg-card pl-9 pr-10"
          aria-label="Buscar evaluación o instrumento"
          aria-describedby={hint ? hintId : undefined}
        />
        <Button
          type="submit"
          size="icon"
          variant="ghost"
          disabled={isTooShort}
          title="Buscar"
          aria-label="Buscar"
          className="absolute right-0 top-0 h-full w-9"
        >
          {isDebouncing ? <Loader2 className="animate-spin" /> : <Search />}
        </Button>
      </div>
      <p
        id={hintId}
        aria-live="polite"
        className={`min-h-4 text-xs ${isTooShort ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {hint}
      </p>
    </form>
  );
}
