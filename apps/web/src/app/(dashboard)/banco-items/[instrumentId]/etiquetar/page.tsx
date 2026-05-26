import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  ITEM_BANK_ROLES,
  type InstrumentModel,
  type ItemModel,
  type CurriculumModel,
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
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, ITEM_BANK_ROLES)) redirect('/dashboard');

  const { instrumentId } = await params;

  const [instrument, itemsResponse, curricula] = await Promise.all([
    apiGet<InstrumentModel>(`/instruments/${instrumentId}`),
    apiGet<ItemsListResponse>(`/items?instrumentId=${instrumentId}&limit=200`),
    apiGet<CurriculumModel[]>('/taxonomies/curricula'),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href={'/banco-items' as Route} className="hover:text-foreground">
            Banco de Items
          </Link>
          <span>/</span>
          <Link
            href={`/banco-items/${instrumentId}` as Route}
            className="hover:text-foreground"
          >
            {instrument.name}
          </Link>
          <span>/</span>
          <span>Etiquetar con IA</span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold">Etiquetado con IA</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Selecciona los items a etiquetar, elige un curriculo de referencia y revisa las
          sugerencias de la IA antes de confirmarlas.
        </p>
      </div>

      <AiTaggingWizard
        instrumentId={instrumentId}
        items={itemsResponse.data}
        curricula={curricula}
      />
    </div>
  );
}
