import { redirect } from 'next/navigation';
import { BarChart3 } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  BENCHMARKING_VIEWER_ROLES,
  benchmarkModeSchema,
  type BenchmarkInstrumentListResponse,
  type BenchmarkInstrumentOption,
  type BenchmarkComparisonResponse,
  type BenchmarkMode,
} from '@soe/types';
import { PageContainer, PageHeader, EmptyState } from '@/components/patterns';
import { BenchmarkToolbar } from './components/benchmark-toolbar';
import { ComparisonView } from './components/comparison-view';

// ─────────────────────────────────────────────────────────────────────────────
// H7.5 — Dashboard de benchmarking institucional. Server Component: resuelve auth
// + acceso, carga los instrumentos comparables y, si hay uno seleccionado, la
// comparación. Los filtros (instrumento, modo, cohorte) viven en la URL: cambiarlos
// navega y este componente refetchea (sin useEffect para el fetch inicial).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';

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

export default async function BenchmarkingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, BENCHMARKING_VIEWER_ROLES)) {
    redirect('/dashboard');
  }

  const params = await searchParams;
  const instrumentId = pickParam(params.instrumentId);
  const gradeId = pickParam(params.gradeId);
  const subjectId = pickParam(params.subjectId);
  const dependence = pickParam(params.dependence);
  const region = pickParam(params.region);
  const commune = pickParam(params.commune);

  const modeParsed = benchmarkModeSchema.safeParse(pickParam(params.mode));
  const mode: BenchmarkMode = modeParsed.success ? modeParsed.data : 'global';

  const header = (
    <PageHeader
      title="Benchmarking"
      description="Compara el desempeño de tu colegio contra una cohorte de perfil similar (global anónima) o contra los colegios de tu red/sostenedor (identificada). Comparación mismo-instrumento, apples-to-apples (E7 — H7.5)."
    />
  );

  // Instrumentos comparables (instrumentos donde la org tiene datos).
  // Los errores de API se propagan al error boundary de (dashboard)/error.tsx.
  const instrumentsResponse = await apiGet<BenchmarkInstrumentListResponse>(
    '/benchmarking/instruments',
  );
  const instruments: BenchmarkInstrumentOption[] = instrumentsResponse.data;

  if (instruments.length === 0) {
    return (
      <PageContainer>
        {header}
        <EmptyState
          icon={BarChart3}
          title="Aún no hay instrumentos para comparar"
          description="El benchmarking necesita resultados procesados de tu colegio. Importa y procesa una evaluación para habilitar la comparación."
        />
      </PageContainer>
    );
  }

  const selectedKey = selectedOptionKey(
    instruments,
    instrumentId,
    gradeId,
    subjectId,
  );

  const toolbar = (
    <BenchmarkToolbar
      instruments={instruments}
      selectedKey={selectedKey}
      mode={mode}
      cohort={{ dependence, region, commune }}
    />
  );

  // Sin instrumento seleccionado (o clave inválida): pedir selección.
  if (!instrumentId || !selectedKey) {
    return (
      <PageContainer>
        {header}
        {toolbar}
        <EmptyState
          icon={BarChart3}
          title="Selecciona un instrumento"
          description="Elige un instrumento del selector para comparar el desempeño de tu colegio contra la cohorte."
        />
      </PageContainer>
    );
  }

  // Construir la query de comparación.
  const query = new URLSearchParams({ instrumentId, mode });
  if (gradeId) query.set('gradeId', gradeId);
  if (subjectId) query.set('subjectId', subjectId);
  if (mode === 'global') {
    if (dependence) query.set('dependence', dependence);
    if (region) query.set('region', region);
    if (commune) query.set('commune', commune);
  }

  const comparison = await apiGet<BenchmarkComparisonResponse>(
    `/benchmarking/comparison?${query.toString()}`,
  );

  return (
    <PageContainer>
      {header}
      {toolbar}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {comparison.instrumentName}
        </p>
      </div>
      <ComparisonView comparison={comparison} />
    </PageContainer>
  );
}
