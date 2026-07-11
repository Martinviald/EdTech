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
  TAXONOMY_NODE_TYPES,
  type ItemBankScope,
  type ItemModel,
  type InstrumentModel,
  type TaxonomyNodeModel,
} from '@soe/types';
import { ItemBankScopeSelect } from './ItemBankScopeSelect';
import { ItemBankFilters, type CatalogEntry } from './ItemBankFilters';
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

// Tipos de nodo que NO se ofrecen como filtro en el banco de ítems. El
// descriptor es metadato fino del ítem (contexto para IA remedial), no una
// dimensión de exploración útil aquí.
const HIDDEN_FILTER_NODE_TYPES = new Set<string>(['descriptor']);

function parseScope(raw: string | string[] | undefined): ItemBankScope {
  const value = typeof raw === 'string' ? raw : undefined;
  return (ITEM_BANK_SCOPES as readonly string[]).includes(value ?? '')
    ? (value as ItemBankScope)
    : 'all';
}

function parseSingle(raw: string | string[] | undefined): string | undefined {
  const value = typeof raw === 'string' ? raw.trim() : undefined;
  return value ? value : undefined;
}

function parseCsvIds(raw: string | string[] | undefined): string[] {
  const value = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join(',') : '';
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// TKT-14 — Banco de ítems global (cross-instrumento). Filtros en cascada:
// asignatura + nivel acotan las opciones de un dropdown por tipo de nodo; los
// nodos elegidos filtran los ítems server-side con intersección AND (OR dentro de
// cada tipo). Las opciones salen de los árboles de taxonomía visibles (facets).
export default async function BancoItemsExplorarPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, ITEM_VIEWER_ROLES)) redirect('/dashboard');

  const params = await searchParams;
  const scope = parseScope(params.scope);
  const subjectId = parseSingle(params.subjectId);
  const gradeId = parseSingle(params.gradeId);

  // Selección por tipo de nodo (una clave por TaxonomyNodeType en la URL).
  const selectedByType: Record<string, string[]> = {};
  for (const type of TAXONOMY_NODE_TYPES) {
    if (HIDDEN_FILTER_NODE_TYPES.has(type)) continue;
    const ids = parseCsvIds(params[type]);
    if (ids.length > 0) selectedByType[type] = ids;
  }

  // Query de facets (nodos acotados por asignatura/nivel para los dropdowns).
  const facetsQuery = new URLSearchParams();
  if (subjectId) facetsQuery.set('subjectId', subjectId);
  if (gradeId) facetsQuery.set('gradeId', gradeId);

  // Query de ítems: asignatura/nivel + un grupo AND por cada tipo con selección.
  const itemsQuery = new URLSearchParams();
  itemsQuery.set('scope', scope);
  // El DTO de /items usa paginationSchema (`pageSize`, máx 100). Con el filtrado
  // facetado server-side, una página basta; el aviso de "truncado" sugiere afinar.
  itemsQuery.set('pageSize', '100');
  if (subjectId) itemsQuery.set('subjectId', subjectId);
  if (gradeId) itemsQuery.set('gradeId', gradeId);
  for (const ids of Object.values(selectedByType)) {
    if (ids.length > 0) itemsQuery.append('taxonomyNodeGroups', ids.join(','));
  }

  const [itemsResponse, instrumentsResponse, subjects, grades, facetNodes] = await Promise.all([
    apiGet<ItemsListResponse>(`/items?${itemsQuery.toString()}`),
    apiGet<InstrumentsListResponse>('/instruments?limit=200'),
    apiGet<CatalogEntry[]>('/catalog/subjects'),
    apiGet<CatalogEntry[]>('/catalog/grades'),
    apiGet<TaxonomyNodeModel[]>(`/taxonomies/nodes/facets?${facetsQuery.toString()}`),
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
        description="Explora todos los ítems del colegio, cruzando instrumentos, y fíltralos por asignatura, nivel y tags de taxonomía (OA, habilidad, tipo de texto)."
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

      <ItemBankFilters
        subjects={subjects}
        grades={grades}
        facetNodes={facetNodes.filter((n) => !HIDDEN_FILTER_NODE_TYPES.has(n.type))}
        subjectId={subjectId}
        gradeId={gradeId}
        selectedByType={selectedByType}
      />

      <ItemBankExplorer items={items} instrumentNames={instrumentNames} />

      {truncated && (
        <p className="text-center text-xs text-muted-foreground">
          Mostrando {items.length} de {itemsResponse.total} ítems. Afina el alcance o los filtros
          para acotar la búsqueda.
        </p>
      )}
    </PageContainer>
  );
}
