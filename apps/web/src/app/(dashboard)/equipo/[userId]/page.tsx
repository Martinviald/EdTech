import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { ArrowLeft, GraduationCap } from 'lucide-react';
import {
  canAccess,
  TEACHER_PERFORMANCE_VIEWER_ROLES,
  type TeacherPerformance,
  type TeacherPerformanceSubject,
} from '@soe/types';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { EmptyState, PageContainer, PageHeader } from '@/components/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PerformanceBadge } from '../../resultados/components/performance-badge';
import { getTeacherPerformance } from '../../resultados/tablero-maestro/data';

export const dynamic = 'force-dynamic';

function subjectHref(subject: TeacherPerformanceSubject, classGroupId: string): Route | null {
  if (subject.assessmentIds.length === 1) {
    return `${ROUTES.evaluacionDetalle(subject.assessmentIds[0]!)}?classGroupId=${classGroupId}` as Route;
  }
  if (subject.assessmentIds.length > 1) {
    return `${ROUTES.evaluaciones}?classGroupId=${classGroupId}&subjectId=${subject.subjectId}` as Route;
  }
  return null;
}

export default async function TeacherPerformancePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, TEACHER_PERFORMANCE_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const { userId } = await params;

  let data: TeacherPerformance;
  try {
    data = await getTeacherPerformance(userId, '');
  } catch {
    notFound();
  }

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={
          <Link
            href={ROUTES.equipo}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Equipo
          </Link>
        }
        title={data.teacher.name || 'Profesor'}
        description={data.teacher.email || undefined}
      />

      {data.classes.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="Sin cursos con resultados"
          description="Este docente no tiene asignaturas con resultados de evaluación en el año seleccionado."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.classes.map((classGroup) => (
            <Card key={classGroup.classGroupId}>
              <CardHeader>
                <CardTitle className="text-base">
                  {classGroup.gradeName} · {classGroup.className}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asignatura</TableHead>
                      <TableHead className="text-center">% Logro</TableHead>
                      <TableHead className="text-center">Nivel</TableHead>
                      <TableHead className="text-right">Alumnos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {classGroup.subjects.map((subject) => {
                      const metric = subject.metrics.find(
                        (candidate) => candidate.key === data.primaryMetricKey,
                      );
                      const href = subjectHref(subject, classGroup.classGroupId);
                      return (
                        <TableRow key={subject.subjectId}>
                          <TableCell>
                            {href ? (
                              <Link href={href} className="hover:text-primary">
                                {subject.subjectName}
                              </Link>
                            ) : (
                              subject.subjectName
                            )}
                            {subject.role === 'assistant' ? (
                              <span className="ml-1 text-xs text-muted-foreground">(Ayudante)</span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-center tabular-nums">
                            {metric?.display ?? '—'}
                          </TableCell>
                          <TableCell className="text-center">
                            <PerformanceBadge level={metric?.level ?? null} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {subject.studentsAssessed}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
