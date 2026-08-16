'use client';

import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

// ─────────────────────────────────────────────────────────────────────────────
// Memoria de los filtros de cada listado, para que el enlace de vuelta los
// devuelva.
//
// Los filtros de un listado viven en la querystring (`/evaluaciones?gradeId=…`),
// pero el enlace de vuelta de una vista de detalle apunta a la ruta pelada
// (`page-titles.ts` declara `parent: { href: ROUTES.evaluaciones }`). Volver
// perdía el filtro y el usuario tenía que rehacerlo.
//
// En vez de arrastrar la querystring por cada enlace hacia el detalle, se recuerda
// la última que tuvo cada ruta y el enlace de vuelta la re-aplica. Así funciona
// para todos los listados a la vez, incluidos los que se abren desde el buscador
// o desde un link pegado.
//
// `sessionStorage` y no estado en memoria: sobrevive a un refresh de la vista de
// detalle, y muere con la pestaña (dos pestañas con filtros distintos no se pisan).
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'soe.listSearch';

/** Tope de rutas recordadas: los listados son pocos, esto sólo acota la basura. */
const MAX_ENTRIES = 20;

type Memory = Record<string, string>;

function read(): Memory {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Memory) : {};
  } catch {
    return {};
  }
}

function write(memory: Memory): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Storage lleno o bloqueado: el enlace de vuelta degrada a la ruta pelada.
  }
}

/**
 * Registra la querystring vigente de `pathname`. Una querystring vacía BORRA lo
 * recordado: si el usuario limpió los filtros, volver no debe resucitarlos.
 */
export function rememberListSearch(pathname: string, search: string): void {
  const memory = read();
  if (!search && !(pathname in memory)) return;

  delete memory[pathname];
  const entries = Object.entries(memory).slice(-(MAX_ENTRIES - 1));
  if (search) entries.push([pathname, search]);
  write(Object.fromEntries(entries));
}

/** Última querystring conocida de `pathname` (cadena vacía si no hay). */
export function recallListSearch(pathname: string): string {
  return read()[pathname] ?? '';
}

/**
 * Monta esto una vez por layout con barra superior: recuerda la querystring de
 * cada vista visitada. No pinta nada.
 */
export function ListSearchMemory() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    rememberListSearch(pathname, searchParams.toString());
  }, [pathname, searchParams]);

  return null;
}

/**
 * `href` con los filtros que ese listado tenía la última vez. Devuelve `href` tal
 * cual en el primer render (el servidor no ve `sessionStorage`) y lo enriquece al
 * hidratar, así que no hay desajuste de hidratación.
 */
export function useRememberedHref(href: string | undefined): string | undefined {
  const pathname = usePathname();
  const [remembered, setRemembered] = useState(href);

  useEffect(() => {
    if (!href || href.includes('?')) {
      setRemembered(href);
      return;
    }
    const search = recallListSearch(href);
    setRemembered(search ? `${href}?${search}` : href);
    // `pathname` en las dependencias: el enlace se re-evalúa en cada navegación,
    // porque el componente que lo pinta vive en el layout y no se remonta.
  }, [href, pathname]);

  return remembered;
}
