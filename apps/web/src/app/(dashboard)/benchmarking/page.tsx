import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { BarChart3 } from 'lucide-react';
import { auth } from '@/auth';
import {
  canAccess,
  BENCHMARKING_VIEWER_ROLES,
  benchmarkModeSchema,
  type BenchmarkInstrumentOption,
  type BenchmarkMode,
} from '@soe/types';
import {
  PageContainer,
  PageHeader,
  EmptyState,
  FilterBarSkeleton,
  CardSkeleton,
} from '@/components/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { FeatureUpgradeNotice } from '@/components/feature-gate';
import { isFeatureEnabled } from '@/lib/features';
import { ROUTES } from '@/lib/routes';
import { BenchmarkToolbar } from './components/benchmark-toolbar';
import { ComparisonView } from './components/comparison-view';
import { getBenchmarkInstruments, getBenchmarkComparison } from './data';

// ─────────────────────────────────────────────────────────────────────────────
// H7.5 — Dashboard de benchmarking institucional. Server Component: resuelve auth
// + acceso, y luego streamea por sección (shell instantáneo): los instrumentos
// comparables y, si hay uno seleccionado, la comparación (Suspense anidado). Los
// filtros (instrumento, modo, cohorte) viven en la URL: cambiarlos navega y este
// componente refetchea (sin useEffect para el fetch inicial).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';

type BenchmarkSelection = {
  instrumentId: string | undefined;
  gradeId: string | undefined;
  subjectId: string | undefined;
  dependence: string | undefined;
  region: string | undefined;
  commune: string | undefined;
  mode: BenchmarkMode;
};

function pickParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

/** Reconstruye la clave de instrumento usada por el toolbar a partir de la URL. */
function selectedOptionKey(
  instruments: BenchmarkInstrumentOption[],
  instrumentId: string | undefined,
  gradeId: string | undefined,
  subjectId: string | undefined,
): string | undefined {
  if (!instrumentId) return undefined;
  const match = instruments.find(
    (i) =>
      i.instrumentId === instrumentId &&
      (i.gradeId ?? '') === (gradeId ?? '') &&
      (i.subjectId ?? '') === (subjectId ?? ''),
  );
  if (!match) return undefined;
  return [match.instrumentId, match.gradeId ?? '', match.subjectId ?? ''].join('|');
}

function buildComparisonQuery(selection: BenchmarkSelection, instrumentId: string): string {
  const query = new URLSearchParams({ instrumentId, mode: selection.mode });
  if (selection.gradeId) query.set('gradeId', selection.gradeId);
  if (selection.subjectId) query.set('subjectId', selection.subjectId);
  if (selection.mode === 'global') {
    if (selection.dependence) query.set('dependence', selection.dependence);
    if (selection.region) query.set('region', selection.region);
    if (selection.commune) query.set('commune', selection.commune);
  }
  return query.toString();
}

export default async function BenchmarkingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, BENCHMARKING_VIEWER_ROLES)) {
    redirect(ROUTES.dashboard);
  }
  if (!(await isFeatureEnabled('benchmarking'))) {
    return <FeatureUpgradeNotice feature="benchmarking" />;
  }

  const params = await searchParams;
  const modeParsed = benchmarkModeSchema.safeParse(pickParam(params.mode));
  const selection: BenchmarkSelection = {
    instrumentId: pickParam(params.instrumentId),
    gradeId: pickParam(params.gradeId),
    subjectId: pickParam(params.subjectId),
    dependence: pickParam(params.dependence),
    region: pickParam(params.region),
    commune: pickParam(params.commune),
    mode: modeParsed.success ? modeParsed.data : 'global',
  };

  return (
    <PageContainer>
      <PageHeader
        title="Benchmarking"
        description="Compara el desempeño de tu colegio contra una cohorte de perfil similar (global anónima) o contra los colegios de tu red/sostenedor (identificada). Comparación mismo-instrumento, apples-to-apples (E7 — H7.5)."
      />

      <Suspense fallback={<FilterBarSkeleton />}>
        <BenchmarkingBody selection={selection} />
      </Suspense>
    </PageContainer>
  );
}

async function BenchmarkingBody({ selection }: { selection: BenchmarkSelection }) {
  const instrumentsResponse = await getBenchmarkInstruments();
  const instruments: BenchmarkInstrumentOption[] = instrumentsResponse.data;

  if (instruments.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Aún no hay instrumentos para comparar"
        description="El benchmarking necesita resultados procesados de tu colegio. Importa y procesa una evaluación para habilitar la comparación."
      />
    );
  }

  const selectedKey = selectedOptionKey(
    instruments,
    selection.instrumentId,
    selection.gradeId,
    selection.subjectId,
  );

  const toolbar = (
    <BenchmarkToolbar
      instruments={instruments}
      selectedKey={selectedKey}
      mode={selection.mode}
      cohort={{
        dependence: selection.dependence,
        region: selection.region,
        commune: selection.commune,
      }}
    />
  );

  if (!selection.instrumentId || !selectedKey) {
    return (
      <>
        {toolbar}
        <EmptyState
          icon={BarChart3}
          title="Selecciona un instrumento"
          description="Elige un instrumento del selector para comparar el desempeño de tu colegio contra la cohorte."
        />
      </>
    );
  }

  const query = buildComparisonQuery(selection, selection.instrumentId);

  return (
    <>
      {toolbar}
      <Suspense fallback={<ComparisonSkeleton />}>
        <ComparisonSection query={query} />
      </Suspense>
    </>
  );
}

async function ComparisonSection({ query }: { query: string }) {
  const comparison = await getBenchmarkComparison(query);
  return (
    <>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{comparison.instrumentName}</p>
      </div>
      <ComparisonView comparison={comparison} />
    </>
  );
}

function ComparisonSkeleton() {
  return (
    <>
      <Skeleton className="h-5 w-64" />
      <CardSkeleton rows={4} />
    </>
  );
}
