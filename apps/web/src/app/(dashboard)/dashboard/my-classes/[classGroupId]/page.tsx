import Link from 'next/link';
import type { Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import { BookOpen, ChevronLeft, GraduationCap, Users } from 'lucide-react';
import {
  canAccess,
  CLASS_VIEWER_ROLES,
  type ClassGroupDetailResponse,
  type EnrollmentStatus,
} from '@soe/types';
import { auth } from '@/auth';
import { getClassGroupDetail } from '@/lib/teacherAssignmentsApi';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/EmptyState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const ENROLLMENT_STATUS_LABEL: Record<EnrollmentStatus, string> = {
  active: 'Matriculado',
  transferred: 'Trasladado',
  graduated: 'Egresado',
  withdrawn: 'Retirado',
};

function EnrollmentStatusBadge({ status }: { status: EnrollmentStatus }) {
  if (status === 'active') {
    return <Badge variant="default">{ENROLLMENT_STATUS_LABEL[status]}</Badge>;
  }
  if (status === 'withdrawn') {
    return <Badge variant="destructive">{ENROLLMENT_STATUS_LABEL[status]}</Badge>;
  }
  return <Badge variant="secondary">{ENROLLMENT_STATUS_LABEL[status]}</Badge>;
}

export default async function ClassGroupDetailPage({
  params,
}: {
  params: Promise<{ classGroupId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.orgId) redirect('/login');
  if (!canAccess(session.user.roles, CLASS_VIEWER_ROLES)) redirect('/dashboard');

  const { classGroupId } = await params;

  let data: ClassGroupDetailResponse;
  try {
    data = await getClassGroupDetail(session.user.orgId, classGroupId);
  } catch {
    notFound();
  }

  const { classGroup, students, subjects } = data;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={'/dashboard/my-classes' as Route}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" /> Volver a mis cursos
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">
            {classGroup.gradeShortName} · {classGroup.name}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Año {classGroup.academicYear} · {students.length}{' '}
            {students.length === 1 ? 'alumno' : 'alumnos'} · {subjects.length}{' '}
            {subjects.length === 1 ? 'asignatura' : 'asignaturas'}
          </p>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Users className="size-5 text-muted-foreground" aria-hidden />
          <h2 className="text-lg font-medium">Alumnos</h2>
        </div>
        {students.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Sin alumnos matriculados"
            description="Este curso aún no tiene alumnos matriculados en el año académico vigente."
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Apellido</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>RUT</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {students.map((s) => (
                    <TableRow key={s.studentId}>
                      <TableCell className="font-medium">{s.lastName}</TableCell>
                      <TableCell>{s.firstName}</TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {s.rut}
                      </TableCell>
                      <TableCell>
                        <EnrollmentStatusBadge status={s.enrollmentStatus} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <GraduationCap className="size-5 text-muted-foreground" aria-hidden />
          <h2 className="text-lg font-medium">Asignaturas y profesores</h2>
        </div>
        {subjects.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="Sin asignaturas asignadas"
            description="Este curso aún no tiene asignaturas configuradas."
          />
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {subjects.length} asignaturas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {subjects.map((subject) => (
                <div
                  key={subject.subjectClassId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <span className="font-medium">{subject.subjectName}</span>
                  <div className="flex flex-wrap gap-2">
                    {subject.teachers.length === 0 ? (
                      <span className="text-sm text-muted-foreground">
                        Sin profesor asignado
                      </span>
                    ) : (
                      subject.teachers.map((teacher) => (
                        <span
                          key={teacher.userId}
                          className="inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-sm"
                        >
                          <span>{teacher.name}</span>
                          {teacher.role === 'primary' ? (
                            <Badge variant="default">Titular</Badge>
                          ) : (
                            <Badge variant="secondary">Asistente</Badge>
                          )}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
