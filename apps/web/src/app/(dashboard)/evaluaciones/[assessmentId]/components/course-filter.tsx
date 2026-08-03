'use client';

import { useCallback, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { FilterBar, type FilterField } from '@/components/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Selector de curso del hub de evaluación. Dentro del hub la evaluación ya está
// elegida: el único acotamiento que aplica es el curso, y sólo entre los cursos
// que rindieron ESTA evaluación. Los demás filtros del panorama (período,
// asignatura, nivel, tipo, instrumento, momento) no tienen efecto acá — el
// filtrado de evaluaciones se hace en `/evaluaciones`.
// ─────────────────────────────────────────────────────────────────────────────

export function AssessmentCourseFilter({
  courses,
  value,
  basePath,
}: {
  courses: readonly { id: string; name: string }[];
  /** `classGroupId` activo; `undefined` = todos los cursos de la evaluación. */
  value: string | undefined;
  /** basePath de la pestaña actual; el selector actualiza la querystring. */
  basePath: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // La transición mantiene visible el contenido previo (sin flash de skeleton)
  // y expone `isPending` para la barra de progreso de FilterBar.
  const [isPending, startTransition] = useTransition();

  const updateCourse = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next) params.set('classGroupId', next);
      else params.delete('classGroupId');
      params.delete('page');
      const qs = params.toString();
      startTransition(() => {
        router.push(`${basePath}${qs ? `?${qs}` : ''}` as Route);
      });
    },
    [router, searchParams, basePath],
  );

  // Con un solo curso no hay nada que elegir: la vista ya es la de ese curso.
  if (courses.length < 2) return null;

  const fields: FilterField[] = [
    {
      key: 'classGroupId',
      label: 'Curso',
      placeholder: 'Todos los cursos',
      value,
      options: courses.map((c) => ({ id: c.id, label: c.name })),
      onChange: updateCourse,
    },
  ];

  // Un solo campo: la barra no necesita ocupar todo el ancho de la vista.
  return <FilterBar fields={fields} pending={isPending} className="sm:max-w-sm" />;
}
