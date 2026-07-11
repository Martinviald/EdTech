import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { PageContainer, PageHeader } from '@/components/patterns';
import {
  canAccess,
  ITEM_VIEWER_ROLES,
  ITEM_BANK_SCOPES,
  type ItemBankScope,
  type ItemModel,
  type InstrumentModel,
} from '@soe/types';
import { ItemBankScopeSelect } from './ItemBankScopeSelect';
import { ItemBankExplorer } from './ItemBankExplorer';

type ItemsListResponse = {
  data: ItemModel[];
  total: number;
  page: number;
  limit: number;
};

type InstrumentsListResponse = {
  data: InstrumentModel[];
  total: number;
  page: number;
  limit: number;
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function parseScope(raw: string | string[] | undefined): ItemBankScope {
  const value = typeof raw === 'string' ? raw : undefined;
  return (ITEM_BANK_SCOPES as readonly string[]).includes(value ?? '')
    ? (value as ItemBankScope)
    : 'all';
}

// TKT-14 — Banco de ítems global (cross-instrumento). Lista todos los ítems del
// alcance elegido (propios / globales / todos) con el filtro multi-tag (OR).
export default async function BancoItemsExplorarPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, ITEM_VIEWER_ROLES)) redirect('/dashboard');

  const params = await searchParams;
  const scope = parseScope(params.scope);

  const [itemsResponse, instrumentsResponse] = await Promise.all([
    apiGet<ItemsListResponse>(`/items?scope=${scope}&limit=500`),
    apiGet<InstrumentsListResponse>('/instruments?limit=200'),
  ]);

  const items = itemsResponse.data;
  const instrumentNames = Object.fromEntries(
    instrumentsResponse.data.map((inst) => [inst.id, inst.name]),
  );

  const truncated = itemsResponse.total > items.length;

  return (
    <PageContainer>
      <PageHeader
        title="Banco de ítems"
        description="Explora todos los ítems del colegio, cruzando instrumentos, y fíltralos por tags de taxonomía (OA, habilidad, contenido, tipo de texto)."
        actions={
          <Link
            href={'/banco-items' as Route}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Banco de Instrumentos
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <ItemBankScopeSelect value={scope} />
      </div>

      <ItemBankExplorer items={items} instrumentNames={instrumentNames} />

      {truncated && (
        <p className="text-center text-xs text-muted-foreground">
          Mostrando {items.length} de {itemsResponse.total} ítems. Afina el alcance o los tags para
          acotar la búsqueda.
        </p>
      )}
    </PageContainer>
  );
}
