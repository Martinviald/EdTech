import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { UserSearch } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  RESULTS_VIEWER_ROLES,
  studentSignalsQuerySchema,
  type StudentSignal,
  type StudentSignalsQueryDto,
  type StudentSignalsResponse,
} from '@soe/types';
import { PageContainer, EmptyState, CardSkeleton } from '@/components/shared';
import { SignalsTable } from './components/signals-table';

type SearchParams = Record<string, string | string[] | undefined>;

function buildQuery(query: StudentSignalsQueryDto): string {
  const params = new URLSearchParams();
  if (query.classGroupId) params.set('classGroupId', query.classGroupId);
  if (query.signal) params.set('signal', query.signal);
  if (query.search) params.set('search', query.search);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export default async function EstudiantesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, RESULTS_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const parsed = studentSignalsQuerySchema.safeParse(await searchParams);
  const query: StudentSignalsQueryDto = parsed.success ? parsed.data : {};

  return (
    <PageContainer>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Los estudiantes que necesitan atención emergen solos: cada señal se lee contra la escala de
        su propio instrumento o contra su resultado comparable anterior, nunca contra un corte fijo
        de logro. Entra a un estudiante para ver su panorama por asignatura.
      </p>

      <Suspense key={JSON.stringify(query)} fallback={<CardSkeleton rows={8} />}>
        <SignalsSection query={query} />
      </Suspense>
    </PageContainer>
  );
}

async function SignalsSection({ query }: { query: StudentSignalsQueryDto }) {
  const result = await apiGet<StudentSignalsResponse>(
    `/students/signals${buildQuery(query)}`,
  ).catch((): StudentSignalsResponse | null => null);

  if (!result) {
    return (
      <EmptyState
        icon={UserSearch}
        title="No se pudo cargar la lista"
        description="Vuelve a intentar, o revisa que tu perfil tenga cursos asignados."
      />
    );
  }

  return (
    <SignalsTable
      result={result}
      activeSignal={(query.signal as StudentSignal | undefined) ?? null}
      search={query.search ?? ''}
    />
  );
}
