import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { ClipboardList, FileUp, SearchX } from 'lucide-react';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  attachSeverity,
  sortAssessments,
  ASSESSMENT_SORTS,
  DASHBOARD_VIEWER_ROLES,
  ANSWER_SHEET_IMPORT_ROLES,
  type AssessmentSort,
} from '@soe/types';
import {
  PageContainer,
  EmptyState,
  CompactFilterBarSkeleton,
  TableSkeleton,
} from '@/components/shared';
import { Button } from '@/components/ui/button';
import { DashboardFilterBar } from '../resultados/components/dashboard-filter-bar';
import {
  parseDashboardFilters,
  withEntryDefaults,
  buildDashboardQuery,
  buildDashboardHref,
  buildClearProcessQuery,
  type DashboardFilterValues,
} from '../resultados/components/dashboard-filters';
import { AssessmentList } from './components/assessment-list';
import {
  getEvaluacionesFilters,
  getEvaluacionesAssessments,
  getEvaluacionesComparable,
} from './data';

export const dynamic = 'force-dynamic';

const BASE_PATH = ROUTES.evaluaciones;

export default async function EvaluacionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, DASHBOARD_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const params = await searchParams;
  const filters = parseDashboardFilters(params);
  const sort = parseAssessmentSort(params);
  // El selector de orden conserva los filtros: sin esto, cambiar el orden
  // descartaba el proceso, la búsqueda y todo lo demás de la URL.
  const sortHref = (next: AssessmentSort) => {
    const next_params = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === 'sort' || value == null) continue;
      for (const v of Array.isArray(value) ? value : [value]) next_params.append(key, v);
    }
    next_params.set('sort', next);
    return `${BASE_PATH}?${next_params.toString()}`;
  };
  const filterQuery = buildDashboardQuery(filters);
  const canImport = canAccess(session.user.roles, ANSWER_SHEET_IMPORT_ROLES);

  return (
    <PageContainer>
      <Suspense fallback={<CompactFilterBarSkeleton />}>
        <FiltersSection filters={filters} query={filterQuery} />
      </Suspense>

      <Suspense fallback={<TableSkeleton />}>
        <AssessmentsSection
          filters={filters}
          query={filterQuery}
          sort={sort}
          sortHref={sortHref}
          canImport={canImport}
        />
      </Suspense>
    </PageContainer>
  );
}

async function FiltersSection({
  filters,
  query,
}: {
  filters: DashboardFilterValues;
  query: string;
}) {
  const options = await getEvaluacionesFilters(query);
  return (
    <DashboardFilterBar
      options={options}
      value={withEntryDefaults(filters, options)}
      basePath={BASE_PATH}
    />
  );
}

/** El orden pedido en la URL; `severity` por defecto. */
function parseAssessmentSort(
  params: Record<string, string | string[] | undefined>,
): AssessmentSort {
  const raw = params.sort;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return ASSESSMENT_SORTS.includes(value as AssessmentSort)
    ? (value as AssessmentSort)
    : 'severity';
}

async function AssessmentsSection({
  filters,
  query,
  sort,
  sortHref,
  canImport,
}: {
  filters: DashboardFilterValues;
  query: string;
  sort: AssessmentSort;
  sortHref: (next: AssessmentSort) => string;
  canImport: boolean;
}) {
  const options = await getEvaluacionesFilters(query);
  const scopedQuery = buildDashboardQuery(withEntryDefaults(filters, options));
  // La lista y las unidades comparables son independientes: en paralelo, y si las
  // unidades fallan la lista igual se muestra (sin gravedad, ordenada por fecha).
  const [assessmentList, comparable] = await Promise.all([
    getEvaluacionesAssessments(scopedQuery),
    getEvaluacionesComparable(scopedQuery).catch(() => null),
  ]);
  const assessments = sortAssessments(
    attachSeverity(assessmentList.data, comparable?.units ?? []),
    comparable ? sort : 'recent',
  );

  if (assessments.length === 0 && filters.q) {
    return <SearchEmptyState filters={withEntryDefaults(filters, options)} />;
  }

  if (assessments.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No hay evaluaciones para mostrar"
        description={
          canImport
            ? 'Ajusta los filtros o importa los resultados de una evaluación para verla aquí.'
            : 'Ajusta los filtros. Si esperabas ver evaluaciones, verifica que tengas asignados los cursos correspondientes.'
        }
        action={
          canImport ? (
            <Button asChild>
              <Link href={ROUTES.importar}>
                <FileUp className="mr-2 size-4" aria-hidden />
                Importar evaluación
              </Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return <AssessmentList assessments={assessments} sort={sort} sortHref={sortHref} />;
}

/**
 * Vacío causado por la búsqueda. Nombra el término y ofrece las dos salidas.
 *
 * La segunda importa tanto como la primera: `withEntryDefaults` acota al proceso
 * más reciente con resultados —y, si no hay, al año vigente— cuando la URL no pide
 * nada, así que buscar "Diagnóstico 2025" parado en el proceso de Cierre 2026
 * devuelve cero sin que nada en pantalla lo explique.
 */
function SearchEmptyState({ filters }: { filters: DashboardFilterValues }) {
  const withoutSearch = `${ROUTES.evaluaciones}${buildDashboardHref({ ...filters, q: undefined })}`;
  const allPeriods = `${ROUTES.evaluaciones}${buildDashboardHref({ ...filters, academicYearId: undefined })}`;
  const allProcesses = `${ROUTES.evaluaciones}${buildClearProcessQuery({ ...filters, q: undefined })}`;

  return (
    <EmptyState
      icon={SearchX}
      title={`Ninguna evaluación coincide con «${filters.q}»`}
      description="La búsqueda se combina con el resto de los filtros, así que puede estar acotada por el período, la asignatura o el nivel seleccionados."
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild variant="outline">
            <Link href={withoutSearch as Route}>Quitar la búsqueda</Link>
          </Button>
          {filters.processId ? (
            <Button asChild variant="outline">
              <Link href={allProcesses as Route}>Buscar en todos los procesos</Link>
            </Button>
          ) : null}
          {filters.academicYearId ? (
            <Button asChild variant="outline">
              <Link href={allPeriods as Route}>Buscar en todos los períodos</Link>
            </Button>
          ) : null}
        </div>
      }
    />
  );
}
