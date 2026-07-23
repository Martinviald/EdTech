import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  ITEM_BANK_ROLES,
  type InstrumentModel,
  type ItemModel,
  type TaxonomyModel,
} from '@soe/types';
import { AiTaggingWizard } from './AiTaggingWizard';

type ItemsListResponse = {
  data: ItemModel[];
  total: number;
  page: number;
  limit: number;
};

type PageProps = {
  params: Promise<{ instrumentId: string }>;
};

export default async function EtiquetarPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, ITEM_BANK_ROLES)) redirect(ROUTES.dashboard);

  const { instrumentId } = await params;

  const [instrument, itemsResponse, taxonomies] = await Promise.all([
    apiGet<InstrumentModel>(`/instruments/${instrumentId}`),
    apiGet<ItemsListResponse>(`/items?instrumentId=${instrumentId}&limit=200`),
    apiGet<TaxonomyModel[]>('/taxonomies'),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href={ROUTES.bancoItems} className="hover:text-foreground">
            Banco de Instrumentos
          </Link>
          <span>/</span>
          <Link
            href={ROUTES.bancoItem(instrumentId)}
            className="hover:text-foreground"
          >
            {instrument.name}
          </Link>
          <span>/</span>
          <span>Etiquetar con IA</span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold">Etiquetado con IA</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Selecciona los items a etiquetar, elige un marco acadÃ©mico de referencia y revisa las
          sugerencias de la IA antes de confirmarlas.
        </p>
      </div>

      <AiTaggingWizard
        instrumentId={instrumentId}
        items={itemsResponse.data}
        taxonomies={taxonomies}
      />
    </div>
  );
}
