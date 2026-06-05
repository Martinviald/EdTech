import { redirect } from 'next/navigation';
import { ClipboardList, Inbox, Table2 } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  ITEM_ANALYSIS_VIEWER_ROLES,
  type AssessmentListResponse,
  type AssessmentOption,
  type DashboardFilterOptionsResponse,
  type ItemMatrixResponse,
} from '@soe/types';
import { PageContainer, PageHeader, EmptyState } from '@/components/patterns';
import { Card, CardContent } from '@/components/ui/card';
import { DashboardFilterBar } from '../components/dashboard-filter-bar';
import {
  parseDashboardFilters,
  buildDashboardQuery,
} from '../components/dashboard-filters';
import { ResultadosNav } from '../components/resultados-nav';
import { AssessmentSelect } from './assessment-select';
import { CrossTable } from './cross-table';

export const dynamic = 'force-dynamic';

const BASE_PATH = '/resultados/detalle';
const LIMIT = 50;

function pickParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

function parsePage(raw: string | string[] | undefined): number {
  const value = pickParam(raw);
  const n = value ? Number.parseInt(value, 10) : 1;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export default async function DetalleResultadosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, ITEM_ANALYSIS_VIEWER_ROLES)) redirect('/dashboard');

  const params = await searchParams;
  const filters = parseDashboardFilters(params);
  const filterQuery = buildDashboardQuery(filters);
  const assessmentId = pickParam(params.assessmentId);
  // El curso (classGroupId) sale del filter bar compartido y acota tanto la lista
  // de evaluaciones como la matriz.
  const classGroupId = filters.classGroupId;
  const page = parsePage(params.page);

  // Opciones de filtro + evaluaciones disponibles (ambas acotadas por los filtros
  // y por el scope del usuario), para poblar el filter bar y el selector.
  const [options, assessmentList] = await Promise.all([
    apiGet<DashboardFilterOptionsResponse>(`/dashboards/filters${filterQuery}`),
    apiGet<AssessmentListResponse>(`/item-analysis/assessments${filterQuery}`),
  ]);

  // Matriz (sólo si hay evaluación seleccionada).
  let matrix: ItemMatrixResponse | null = null;
  let matrixError = false;
  if (assessmentId) {
    try {
      const query = new URLSearchParams();
      query.set('assessmentId', assessmentId);
      if (classGroupId) query.set('classGroupId', classGroupId);
      query.set('page', String(page));
      query.set('limit', String(LIMIT));
      matrix = await apiGet<ItemMatrixResponse>(
        `/item-analysis/matrix?${query.toString()}`,
      );
    } catch {
      matrixError = true;
    }
  }

  // Asegurar que la evaluación seleccionada aparezca en el selector aunque los
  // filtros activos la dejen fuera de la lista (se conoce por la matriz cargada).
  const selectOptions: AssessmentOption[] = [...assessmentList.data];
  if (
    assessmentId &&
    matrix &&
    !selectOptions.some((o) => o.assessmentId === assessmentId)
  ) {
    selectOptions.unshift({
      assessmentId,
      name: matrix.assessmentName,
      instrumentName: matrix.instrumentName,
      instrumentType: '',
      subjectName: null,
      gradeName: null,
      administeredAt: null,
      studentsCount: matrix.students.total,
    });
  }

  return (
    <PageContainer>
      <PageHeader
        title="Detalle alumno × pregunta"
        description="Elige una evaluación para ver la tabla cruzada de respuestas por alumno y pregunta, con distribución y análisis de distractores (H6.11, H6.12)."
      />

      <ResultadosNav />

      <DashboardFilterBar options={options} value={filters} basePath={BASE_PATH} />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <AssessmentSelect
          options={selectOptions}
          value={assessmentId}
          basePath={BASE_PATH}
        />
      </div>

      {renderContent({ assessmentId, matrix, matrixError, classGroupId })}
    </PageContainer>
  );
}

function renderContent({
  assessmentId,
  matrix,
  matrixError,
  classGroupId,
}: {
  assessmentId: string | undefined;
  matrix: ItemMatrixResponse | null;
  matrixError: boolean;
  classGroupId: string | undefined;
}) {
  if (!assessmentId) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Selecciona una evaluación"
        description="La tabla cruzada se construye para una evaluación específica. Usa los filtros y el selector de arriba para elegir una evaluación con resultados."
      />
    );
  }

  if (matrixError || !matrix) {
    return (
      <EmptyState
        icon={Inbox}
        title="No se pudo cargar la tabla cruzada"
        description="No tienes acceso a esta evaluación o no existe. Verifica que tengas asignados los cursos de la evaluación."
      />
    );
  }

  const hasQuestions = matrix.questions.length > 0;
  const hasStudents = matrix.students.total > 0;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold">
            {matrix.assessmentName ?? matrix.instrumentName}
          </h2>
          <p className="text-sm text-muted-foreground">
            {matrix.instrumentName} · {matrix.questions.length} preguntas ·{' '}
            {matrix.students.total} alumnos
          </p>
        </div>

        {!hasQuestions || !hasStudents ? (
          <EmptyState
            icon={Table2}
            title="Sin respuestas para mostrar"
            description={
              !hasStudents
                ? 'No hay alumnos con respuestas registradas en esta evaluación dentro de tu alcance.'
                : 'Esta evaluación aún no tiene preguntas en su instrumento.'
            }
          />
        ) : (
          <CrossTable
            matrix={matrix}
            basePath={BASE_PATH}
            assessmentId={assessmentId}
            classGroupId={classGroupId}
          />
        )}
      </CardContent>
    </Card>
  );
}
