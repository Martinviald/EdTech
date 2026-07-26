import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { FilterBarSkeleton, PaginationControls, TableSkeleton } from '@/components/shared';
import {
  canAccess,
  ITEM_VIEWER_ROLES,
  ITEM_BANK_SCOPES,
  TAXONOMY_NODE_TYPES,
  type ItemBankScope,
  type TaxonomyNodeModel,
} from '@soe/types';
import { ItemBankFilters } from './ItemBankFilters';
import { ItemBankExplorer } from './ItemBankExplorer';
import {
  getCatalogSubjects,
  getCatalogGrades,
  getCurriculumNodes,
  getItems,
  getInstruments,
} from './data';

const PAGE_SIZE = 20;

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

function parseCsvIds(raw: string | string[] | undefined): string[] {
  const value = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join(',') : '';
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

type TaxonomySelection = {
  subjectIds: string[];
  gradeIds: string[];
  selectedLeaf: Record<string, string[]>;
  /** Ids elegidos por tipo PADRE/narrower (p. ej. varios ejes a la vez). */
  selectedParent: Record<string, string[]>;
  groups: string[][];
};

function deriveTaxonomySelection(
  nodes: TaxonomyNodeModel[],
  params: SearchParams,
): TaxonomySelection {
  const subjectIds = parseCsvIds(params.subjectId);
  const gradeIds = parseCsvIds(params.gradeId);

  const parentIds = new Set(nodes.map((n) => n.parentId).filter((p): p is string => Boolean(p)));
  const structuralTypes = new Set(nodes.filter((n) => parentIds.has(n.id)).map((n) => n.type));
  const presentTypes = new Set(nodes.map((n) => n.type));
  const leafTypes = TAXONOMY_NODE_TYPES.filter(
    (t) => presentTypes.has(t) && !structuralTypes.has(t),
  );

  const matchesScope = (n: TaxonomyNodeModel) => {
    if (subjectIds.length > 0 && n.subjectId && !subjectIds.includes(n.subjectId)) return false;
    if (gradeIds.length > 0 && n.gradeId && !gradeIds.includes(n.gradeId)) return false;
    return true;
  };

  const selectedLeaf: Record<string, string[]> = {};
  for (const type of leafTypes) {
    const ids = parseCsvIds(params[type]);
    if (ids.length > 0) selectedLeaf[type] = ids;
  }
  const selectedParent: Record<string, string[]> = {};
  for (const type of structuralTypes) {
    const ids = parseCsvIds(params[type]);
    if (ids.length > 0) selectedParent[type] = ids;
  }

  const groups: string[][] = [];
  for (const [, ids] of Object.entries(selectedLeaf)) {
    if (ids.length > 0) groups.push(ids);
  }
  // Un tipo padre con varios seleccionados (p. ej. dos ejes) es UN grupo: sus
  // hojas se combinan con OR entre sí, igual que dentro de un multi-select.
  for (const parentIds of Object.values(selectedParent)) {
    const children = nodes.filter(
      (n) =>
        n.parentId != null &&
        parentIds.includes(n.parentId) &&
        leafTypes.includes(n.type) &&
        matchesScope(n),
    );
    const childLeafTypes = new Set(children.map((n) => n.type));
    const alreadySelected = [...childLeafTypes].some((t) => (selectedLeaf[t]?.length ?? 0) > 0);
    if (!alreadySelected && children.length > 0) {
      groups.push(children.map((n) => n.id));
    }
  }

  return { subjectIds, gradeIds, selectedLeaf, selectedParent, groups };
}

export default async function BancoItemsExplorarPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, ITEM_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const params = await searchParams;
  const page = typeof params.page === 'string' ? Math.max(1, Number(params.page) || 1) : 1;

  return (
    <>
      <Suspense fallback={<FilterBarSkeleton />}>
        <FiltersSection params={params} />
      </Suspense>

      <Suspense fallback={<TableSkeleton />}>
        <ExplorerSection params={params} page={page} />
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
  const { subjectIds, gradeIds, selectedLeaf, selectedParent } = deriveTaxonomySelection(
    nodes,
    params,
  );
  const difficultyIds = parseCsvIds(params.difficulty);

  return (
    <ItemBankFilters
      subjects={subjects}
      grades={grades}
      nodes={nodes}
      subjectIds={subjectIds}
      gradeIds={gradeIds}
      selectedLeaf={selectedLeaf}
      selectedParent={selectedParent}
      difficultyIds={difficultyIds}
    />
  );
}

async function ExplorerSection({ params, page }: { params: SearchParams; page: number }) {
  const scope = parseScope(params.scope);
  const nodes = await getCurriculumNodes();
  const { subjectIds, gradeIds, groups } = deriveTaxonomySelection(nodes, params);
  const difficultyIds = parseCsvIds(params.difficulty);

  const itemsQuery = new URLSearchParams();
  itemsQuery.set('scope', scope);
  itemsQuery.set('page', String(page));
  itemsQuery.set('pageSize', String(PAGE_SIZE));
  if (subjectIds.length > 0) itemsQuery.set('subjectId', subjectIds.join(','));
  if (gradeIds.length > 0) itemsQuery.set('gradeId', gradeIds.join(','));
  if (difficultyIds.length > 0) itemsQuery.set('difficulty', difficultyIds.join(','));
  for (const group of groups) itemsQuery.append('taxonomyNodeGroups', group.join(','));

  const [itemsResponse, instrumentsResponse] = await Promise.all([
    getItems(itemsQuery.toString()),
    getInstruments(),
  ]);

  const items = itemsResponse.data;
  const instrumentNames = Object.fromEntries(
    instrumentsResponse.data.map((inst) => [inst.id, inst.name]),
  );

  return (
    <>
      <ItemBankExplorer items={items} instrumentNames={instrumentNames} />
      <PaginationControls
        page={page}
        limit={PAGE_SIZE}
        total={itemsResponse.total}
        basePath={ROUTES.bancoItemsExplorar}
      />
    </>
  );
}
