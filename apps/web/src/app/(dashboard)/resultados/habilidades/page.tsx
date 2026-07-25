import { redirect } from 'next/navigation';
import { ROUTES } from '@/lib/routes';

export const dynamic = 'force-dynamic';

/**
 * Compatibilidad: `/resultados/habilidades` se renombró a `/resultados/dimensiones`
 * (el desglose agrupa por dimensión: habilidad, contenido, OA…). Redirige
 * conservando los filtros y el `assessmentId` de la query.
 */
export default async function HabilidadesRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const entry of value) qs.append(key, entry);
    } else if (value != null) {
      qs.set(key, value);
    }
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  redirect(`${ROUTES.resultadosDimensiones}${suffix}`);
}
