'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Espera tras la última tecla antes de disparar la búsqueda sola.
 *
 * Empezó en 3 s, apostando a que detrás había una consulta cara que convenía no
 * repetir. Medido contra la API con la base de desarrollo, no lo era:
 * `comparable-overview` —el endpoint que sostenía ese argumento— promedia 182 ms
 * sin término y 68 ms con uno (el filtro achica el alcance antes de resolver
 * unidades comparables y alertas); `dashboards/overview` 26 ms e
 * `item-analysis/assessments` 11 ms. Si una consulta de más cuesta eso, esperar
 * tres segundos compra muy poco y se lee como una aplicación colgada.
 *
 * 500 ms deja pasar la pausa normal entre teclas y se mantiene bien por debajo
 * del segundo, el umbral donde una interfaz deja de sentirse reactiva. El
 * debounce sigue siendo la red de seguridad, no el disparador principal: Enter y
 * el botón "Buscar" disparan al instante.
 *
 * ⚠️ La medición es sobre la demo (12 evaluaciones, 77 alumnos). Es un piso, no
 * un techo: con la carga de un colegio real conviene volver a medir antes de
 * bajarlo más. Ver docs/diseno-buscador-evaluaciones.md §D8.
 */
export const SEARCH_DEBOUNCE_MS = 500;

type UseDebouncedSearchOptions = {
  /** Término que hoy está en la URL. Es la referencia de "ya buscado". */
  initialTerm: string;
  minLength: number;
  onSubmit: (term: string) => void;
};

type UseDebouncedSearchResult = {
  term: string;
  setTerm: (next: string) => void;
  /** Dispara ya y cancela el temporizador. Lo usan Enter y el botón. */
  submitNow: () => void;
  /** Vacía el término local. Lo llama "Limpiar filtros". */
  reset: () => void;
  /** Hay una búsqueda encolada esperando que expire el temporizador. */
  isDebouncing: boolean;
  /** Lo escrito no alcanza el mínimo (y no está vacío): no se puede enviar. */
  isTooShort: boolean;
};

/**
 * Estado del buscador, con tres disparadores que escriben la MISMA URL: el
 * temporizador, Enter y el botón.
 *
 * `isDebouncing` existe porque el `isPending` de `useTransition` sólo se
 * enciende con el `router.push`, o sea DESPUÉS de los 3 segundos: sin este
 * segundo estado la barra de filtros se ve muerta justo durante la espera que
 * más se nota.
 */
export function useDebouncedSearch({
  initialTerm,
  minLength,
  onSubmit,
}: UseDebouncedSearchOptions): UseDebouncedSearchResult {
  const [term, setTermState] = useState(initialTerm);
  const [isDebouncing, setIsDebouncing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // El callback y el término ya buscado se leen por ref para que cambiar de
  // identidad entre renders no rearme ni dispare el temporizador.
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const submittedTermRef = useRef(initialTerm);
  submittedTermRef.current = initialTerm;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsDebouncing(false);
  }, []);

  // Sincroniza el input cuando el término cambia desde AFUERA: "atrás" del
  // navegador, un link pegado con `?q=`, o "Limpiar filtros". La barra de
  // filtros NO se desmonta al cambiar los searchParams, así que sin esto el
  // input y la URL se desincronizan.
  //
  // Se salta mientras hay una búsqueda encolada: si el usuario siguió tecleando
  // mientras el push anterior viajaba, sincronizar le borraría lo recién
  // escrito. Se lee de una ref (no del estado) a propósito: con `isDebouncing`
  // en las dependencias, el efecto correría al apagarse el temporizador y
  // revertiría el input al término viejo justo antes de que el push aterrice.
  useEffect(() => {
    if (timerRef.current !== null) return;
    setTermState(initialTerm);
  }, [initialTerm]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  /** Sólo vale la pena navegar si el término cambió y es enviable. */
  const shouldSubmit = useCallback(
    (candidate: string): boolean => {
      const trimmed = candidate.trim();
      if (trimmed === submittedTermRef.current) return false;
      return trimmed.length === 0 || trimmed.length >= minLength;
    },
    [minLength],
  );

  const setTerm = useCallback(
    (next: string) => {
      setTermState(next);
      clearTimer();
      if (!shouldSubmit(next)) return;
      setIsDebouncing(true);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setIsDebouncing(false);
        onSubmitRef.current(next.trim());
      }, SEARCH_DEBOUNCE_MS);
    },
    [clearTimer, shouldSubmit],
  );

  const submitNow = useCallback(() => {
    clearTimer();
    if (!shouldSubmit(term)) return;
    onSubmitRef.current(term.trim());
  }, [clearTimer, shouldSubmit, term]);

  const reset = useCallback(() => {
    clearTimer();
    setTermState('');
  }, [clearTimer]);

  const trimmed = term.trim();
  return {
    term,
    setTerm,
    submitNow,
    reset,
    isDebouncing,
    isTooShort: trimmed.length > 0 && trimmed.length < minLength,
  };
}
