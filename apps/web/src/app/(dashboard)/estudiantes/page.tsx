import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { UserSearch } from 'lucide-react';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { canAccess, RESULTS_VIEWER_ROLES } from '@soe/types';
import { PageContainer, EmptyState, CardSkeleton } from '@/components/shared';
import {
  listClassGroupsForUser,
  getClassGroupDetail,
  type ClassGroupForUser,
} from '@/lib/teacherAssignmentsApi';
import { StudentPicker, type PickerCourse, type PickerStudent } from './components/student-picker';

type SearchParams = Record<string, string | string[] | undefined>;

function pick(params: SearchParams, key: string): string | undefined {
  const v = params[key];
  const value = Array.isArray(v) ? v[0] : v;
  return value && value.length > 0 ? value : undefined;
}

/** Cursos únicos (una fila por curso, no por curso × asignatura), año reciente primero. */
function dedupeCourses(rows: ClassGroupForUser[]): PickerCourse[] {
  const map = new Map<string, { label: string; year: number; order: number; name: string }>();
  for (const r of rows) {
    if (map.has(r.classGroupId)) continue;
    map.set(r.classGroupId, {
      label: `${r.gradeShortName} ${r.className} · ${r.academicYear}`,
      year: r.academicYear,
      order: r.gradeOrder,
      name: r.className,
    });
  }
  return [...map.entries()]
    .sort(
      (a, b) =>
        b[1].year - a[1].year ||
        a[1].order - b[1].order ||
        a[1].name.localeCompare(b[1].name, 'es'),
    )
    .map(([id, v]) => ({ id, label: v.label }));
}

export default async function EstudiantesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, RESULTS_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const params = await searchParams;
  const classGroupId = pick(params, 'classGroupId') ?? null;
  const orgId = session.user.orgId;

  return (
    <PageContainer>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Consulta la trayectoria consolidada de un alumno a través de sus evaluaciones — por
        evaluación, por habilidad/eje y por nivel de desempeño. Elige el curso y selecciona al
        estudiante.
      </p>

      {orgId ? (
        <Suspense key={classGroupId ?? 'none'} fallback={<CardSkeleton rows={6} />}>
          <PickerSection orgId={orgId} classGroupId={classGroupId} />
        </Suspense>
      ) : (
        <EmptyState
          icon={UserSearch}
          title="Sin colegio activo"
          description="Selecciona un colegio para buscar estudiantes."
        />
      )}
    </PageContainer>
  );
}

async function PickerSection({
  orgId,
  classGroupId,
}: {
  orgId: string;
  classGroupId: string | null;
}) {
  const rows = await listClassGroupsForUser(orgId).catch((): ClassGroupForUser[] => []);
  const courses = dedupeCourses(rows);

  if (courses.length === 0) {
    return (
      <EmptyState
        icon={UserSearch}
        title="Sin cursos visibles"
        description="No hay cursos con estudiantes disponibles para tu perfil."
      />
    );
  }

  let selected: string | null = null;
  let roster: PickerStudent[] = [];
  if (classGroupId && courses.some((c) => c.id === classGroupId)) {
    selected = classGroupId;
    const detail = await getClassGroupDetail(orgId, classGroupId).catch(() => null);
    roster =
      detail?.students.map((s) => ({
        studentId: s.studentId,
        firstName: s.firstName,
        lastName: s.lastName,
        rut: s.rut,
      })) ?? [];
  }

  return <StudentPicker courses={courses} selectedClassGroupId={selected} roster={roster} />;
}
