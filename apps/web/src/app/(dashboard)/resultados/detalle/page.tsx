import { redirect } from 'next/navigation';
import type { Route } from 'next';

export const dynamic = 'force-dynamic';

function pickParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

/**
 * Compatibilidad: el Detalle alumno × pregunta se movió al hub
 * `/evaluaciones/[assessmentId]/detalle`. Con `assessmentId` en la query se
 * redirige al hub (conservando curso y página); sin él, a la lista de
 * evaluaciones (el nuevo selector).
 *
 * El componente de presentación `cross-table.tsx` (y `assessment-select.tsx`,
 * `actions.ts`) sigue viviendo en esta carpeta: el hub los reutiliza.
 */
export default async function DetalleRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const assessmentId = pickParam(params.assessmentId);
  const classGroupId = pickParam(params.classGroupId);
  const page = pickParam(params.page);

  if (assessmentId) {
    const qs = new URLSearchParams();
    if (classGroupId) qs.set('classGroupId', classGroupId);
    if (page) qs.set('page', page);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    redirect(`/evaluaciones/${assessmentId}/detalle${suffix}` as Route);
  }

  redirect(
    (classGroupId ? `/evaluaciones?classGroupId=${classGroupId}` : '/evaluaciones') as Route,
  );
}
