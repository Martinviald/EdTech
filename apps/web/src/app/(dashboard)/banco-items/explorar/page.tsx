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

// Marco a filtrar (de momento solo Currículum Nacional). Restringe los facets a
// esta taxonomía → los descriptores del marco DIA no aparecen como filtro.
const CURRICULUM_MARCO_TYPE = 'mineduc';

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

  // Nodos del marco curricular (todos): pueblan y acotan los filtros client-side.
  const [subjects, grades, nodes] = await Promise.all([
    apiGet<CatalogEntry[]>('/catalog/subjects'),
    apiGet<CatalogEntry[]>('/catalog/grades'),
    apiGet<TaxonomyNodeModel[]>(`/taxonomies/nodes/facets?taxonomyType=${CURRICULUM_MARCO_TYPE}`),
  ]);

  // Tipos HOJA (etiquetan ítems) vs PADRE (estructura). Se derivan del árbol.
  const parentIds = new Set(nodes.map((n) => n.parentId).filter((p): p is string => Boolean(p)));
  const structuralTypes = new Set(nodes.filter((n) => parentIds.has(n.id)).map((n) => n.type));
  const presentTypes = new Set(nodes.map((n) => n.type));
  const leafTypes = TAXONOMY_NODE_TYPES.filter(
    (t) => presentTypes.has(t) && !structuralTypes.has(t),
  );

  const matchesScope = (n: TaxonomyNodeModel) => {
    if (subjectId && n.subjectId && n.subjectId !== subjectId) return false;
    if (gradeId && n.gradeId && n.gradeId !== gradeId) return false;
    return true;
  };

  // Selección: por tipo HOJA (ids) y por tipo PADRE/narrower (id único).
  const selectedLeaf: Record<string, string[]> = {};
  for (const type of leafTypes) {
    const ids = parseCsvIds(params[type]);
    if (ids.length > 0) selectedLeaf[type] = ids;
  }
  const selectedParent: Record<string, string> = {};
  for (const type of structuralTypes) {
    const id = parseSingle(params[type]);
    if (id) selectedParent[type] = id;
  }

  // Grupos AND para /items: un grupo por dimensión con selección. Si hay un padre
  // (narrower) elegido pero SIN selección explícita de su tipo hoja hijo, se
  // expande a los hijos de ese padre en el ámbito (p. ej. "Eje: Lectura" → todos
  // sus OA). Semántica: AND entre grupos, OR dentro de cada grupo.
  const groups: string[][] = [];
  for (const [, ids] of Object.entries(selectedLeaf)) {
    if (ids.length > 0) groups.push(ids);
  }
  for (const parentId of Object.values(selectedParent)) {
    const children = nodes.filter(
      (n) => n.parentId === parentId && leafTypes.includes(n.type) && matchesScope(n),
    );
    const childLeafTypes = new Set(children.map((n) => n.type));
    const alreadySelected = [...childLeafTypes].some((t) => (selectedLeaf[t]?.length ?? 0) > 0);
    if (!alreadySelected && children.length > 0) {
      groups.push(children.map((n) => n.id));
    }
  }

  // El DTO de /items usa paginationSchema (`pageSize`, máx 100). Con el filtrado
  // facetado server-side, una página basta; el aviso de "truncado" sugiere afinar.
  const itemsQuery = new URLSearchParams();
  itemsQuery.set('scope', scope);
  itemsQuery.set('pageSize', '100');
  if (subjectId) itemsQuery.set('subjectId', subjectId);
  if (gradeId) itemsQuery.set('gradeId', gradeId);
  for (const group of groups) itemsQuery.append('taxonomyNodeGroups', group.join(','));

  const [itemsResponse, instrumentsResponse] = await Promise.all([
    apiGet<ItemsListResponse>(`/items?${itemsQuery.toString()}`),
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
        nodes={nodes}
        subjectId={subjectId}
        gradeId={gradeId}
        selectedLeaf={selectedLeaf}
        selectedParent={selectedParent}
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
