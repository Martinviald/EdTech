import { redirect } from 'next/navigation';
import { ClipboardList, Inbox, Table2 } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  ITEM_ANALYSIS_VIEWER_ROLES,
  type ItemMatrixResponse,
} from '@soe/types';
import { PageContainer, PageHeader, EmptyState } from '@/components/patterns';
import { Card, CardContent } from '@/components/ui/card';
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
  const assessmentId = pickParam(params.assessmentId);
  const classGroupId = pickParam(params.classGroupId);
  const page = parsePage(params.page);

  const header = (
    <PageHeader
      title="Detalle alumno × pregunta"
      description="Tabla cruzada de respuestas por alumno y pregunta, con distribución y análisis de distractores (H6.11, H6.12)."
    />
  );

  // Sin evaluación seleccionada: la matriz es siempre por evaluación.
  if (!assessmentId) {
    return (
      <PageContainer>
        {header}
        <EmptyState
          icon={ClipboardList}
          title="Selecciona una evaluación"
          description="La tabla cruzada se construye para una evaluación específica. Abre el detalle desde una evaluación (parámetro assessmentId en la URL) para ver las respuestas por alumno y pregunta."
        />
      </PageContainer>
    );
  }

  let matrix: ItemMatrixResponse;
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
    return (
      <PageContainer>
        {header}
        <EmptyState
          icon={Inbox}
          title="No se pudo cargar la tabla cruzada"
          description="No tienes acceso a esta evaluación o no existe. Verifica que tengas asignados los cursos de la evaluación."
        />
      </PageContainer>
    );
  }

  const hasQuestions = matrix.questions.length > 0;
  const hasStudents = matrix.students.total > 0;

  return (
    <PageContainer>
      {header}

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
    </PageContainer>
  );
}
