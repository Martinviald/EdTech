import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { FilterBarSkeleton, TableSkeleton } from '@/components/shared';
import {
  canAccess,
  ITEM_VIEWER_ROLES,
  ITEM_BANK_SCOPES,
  TAXONOMY_NODE_TYPES,
  type ItemBankScope,
  type TaxonomyNodeModel,
} from '@soe/types';
import { ItemBankScopeSelect } from './ItemBankScopeSelect';
import { ItemBankFilters } from './ItemBankFilters';
import { ItemBankExplorer } from './ItemBankExplorer';
import {
  getCatalogSubjects,
  getCatalogGrades,
  getCurriculumNodes,
  getItems,
  getInstruments,
} from './data';

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  searchParams: Promise<SearchParams>;
};

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

type TaxonomySelection = {
  subjectId: string | undefined;
  gradeId: string | undefined;
  selectedLeaf: Record<string, string[]>;
  selectedParent: Record<string, string>;
  groups: string[][];
};

function deriveTaxonomySelection(
  nodes: TaxonomyNodeModel[],
  params: SearchParams,
): TaxonomySelection {
  const subjectId = parseSingle(params.subjectId);
  const gradeId = parseSingle(params.gradeId);

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

  return { subjectId, gradeId, selectedLeaf, selectedParent, groups };
}

export default async function BancoItemsExplorarPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, ITEM_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const params = await searchParams;
  const scope = parseScope(params.scope);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <ItemBankScopeSelect value={scope} />
      </div>

      <Suspense fallback={<FilterBarSkeleton />}>
        <FiltersSection params={params} />
      </Suspense>

      <Suspense fallback={<TableSkeleton />}>
        <ExplorerSection params={params} />
      </Suspense>
    </>
  );
}

async function FiltersSection({ params }: { params: SearchParams }) {
  const [subjects, grades, nodes] = await Promise.all([
    getCatalogSubjects(),
    getCatalogGrades(),
    getCurriculumNodes(),
  ]);
  const { subjectId, gradeId, selectedLeaf, selectedParent } = deriveTaxonomySelection(
    nodes,
    params,
  );

  return (
    <ItemBankFilters
      subjects={subjects}
      grades={grades}
      nodes={nodes}
      subjectId={subjectId}
      gradeId={gradeId}
      selectedLeaf={selectedLeaf}
      selectedParent={selectedParent}
    />
  );
}

async function ExplorerSection({ params }: { params: SearchParams }) {
  const scope = parseScope(params.scope);
  const nodes = await getCurriculumNodes();
  const { subjectId, gradeId, groups } = deriveTaxonomySelection(nodes, params);

  const itemsQuery = new URLSearchParams();
  itemsQuery.set('scope', scope);
  itemsQuery.set('pageSize', '100');
  if (subjectId) itemsQuery.set('subjectId', subjectId);
  if (gradeId) itemsQuery.set('gradeId', gradeId);
  for (const group of groups) itemsQuery.append('taxonomyNodeGroups', group.join(','));

  const [itemsResponse, instrumentsResponse] = await Promise.all([
    getItems(itemsQuery.toString()),
    getInstruments(),
  ]);

  const items = itemsResponse.data;
  const instrumentNames = Object.fromEntries(
    instrumentsResponse.data.map((inst) => [inst.id, inst.name]),
  );

  const truncated = itemsResponse.total > items.length;

  return (
    <>
      <ItemBankExplorer items={items} instrumentNames={instrumentNames} />

      {truncated && (
        <p className="text-center text-xs text-muted-foreground">
          Mostrando {items.length} de {itemsResponse.total} ítems. Afina el alcance o los filtros
          para acotar la búsqueda.
        </p>
      )}
    </>
  );
}
