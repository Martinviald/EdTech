import { redirect } from 'next/navigation';
import type { Route } from 'next';

export const dynamic = 'force-dynamic';

function pickParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

/**
 * Compatibilidad: el Informe de evaluación se movió al hub
 * `/evaluaciones/[assessmentId]/resultados`. Con `assessmentId` en la query
 * (links/marcadores antiguos, asistente E21) se redirige al hub; sin él, a la
 * lista de evaluaciones, que es el nuevo selector.
 */
export default async function InformeRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const assessmentId = pickParam(params.assessmentId);
  const classGroupId = pickParam(params.classGroupId);

  if (assessmentId) {
    const qs = classGroupId ? `?classGroupId=${classGroupId}` : '';
    redirect(`/evaluaciones/${assessmentId}/resultados${qs}` as Route);
  }

  redirect(
    (classGroupId ? `/evaluaciones?classGroupId=${classGroupId}` : '/evaluaciones') as Route,
  );
}
