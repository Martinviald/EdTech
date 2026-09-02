import { MessageSquarePlus } from 'lucide-react';
import type { FeedbackAdminListResponse } from '@soe/types';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import { EmptyState, PaginationControls } from '@/components/shared';
import { FeedbackCard, FeedbackFilters } from '@/components/feedback/admin';

export const dynamic = 'force-dynamic';

/**
 * Bandeja de comentarios de toda la plataforma. Es la contraparte del widget
 * in-app: sin un lugar donde leerlos, el canal muere igual que una planilla
 * compartida que nadie abre.
 */
export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; orgId?: string; page?: string }>;
}) {
  const params = await searchParams;

  // Se reenvían tal cual: el schema Zod del backend es el que valida y descarta
  // lo que no corresponda. Duplicar esa validación acá sería otra fuente de verdad.
  const query = new URLSearchParams();
  for (const key of ['status', 'type', 'orgId', 'page'] as const) {
    const value = params[key];
    if (value) query.set(key, value);
  }
  const qs = query.toString();

  const response = await apiGet<FeedbackAdminListResponse>(`/feedback/admin${qs ? `?${qs}` : ''}`);

  const filtered = Boolean(params.status || params.type || params.orgId);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {response.total === 0
          ? 'Sin comentarios que mostrar.'
          : `${response.total} ${response.total === 1 ? 'comentario' : 'comentarios'} en ${response.orgs.length} ${response.orgs.length === 1 ? 'colegio' : 'colegios'}.`}
      </p>

      <FeedbackFilters basePath={ROUTES.adminFeedback} orgs={response.orgs} />

      {response.data.length === 0 ? (
        <EmptyState
          icon={MessageSquarePlus}
          size="lg"
          title={filtered ? 'Ningún comentario coincide' : 'Todavía no hay comentarios'}
          description={
            filtered
              ? 'Prueba quitando algún filtro.'
              : 'Cuando alguien envíe un comentario desde el widget, aparecerá aquí.'
          }
        />
      ) : (
        <>
          <div className="space-y-4">
            {response.data.map((item) => (
              <FeedbackCard key={item.id} item={item} />
            ))}
          </div>
          <PaginationControls
            page={response.page}
            limit={response.limit}
            total={response.total}
            basePath={ROUTES.adminFeedback}
          />
        </>
      )}
    </div>
  );
}
