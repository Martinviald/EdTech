import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, ClipboardList, Inbox, Layers } from 'lucide-react';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { canAccess, RESULTS_VIEWER_ROLES, type StudentPanoramaResponse } from '@soe/types';
import { PageContainer, EmptyState, CardSkeleton, MetricsGroup } from '@/components/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SetPageTitle } from '@/components/layout/page-title-context';
import { PerformanceBadge } from '../../resultados/components/performance-badge';
import { DistributionBar } from '../../resultados/components/distribution-bar';
import { formatAchievement } from '../../resultados/components/performance-level';
import { PanoramaTrajectory } from '../components/panorama-trajectory';
import { getStudentPanorama } from '../data';

function fmtDate(value: string | Date | null): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtGrade(grade: string | null): string {
  if (grade === null) return '—';
  const n = Number(grade);
  return Number.isNaN(n) ? '—' : n.toFixed(1);
}

export default async function EstudiantePanoramaPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, RESULTS_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const { studentId } = await params;

  return (
    <PageContainer>
      <BackLink />
      <Suspense fallback={<CardSkeleton rows={8} />}>
        <PanoramaContent studentId={studentId} />
      </Suspense>
    </PageContainer>
  );
}

function BackLink() {
  return (
    <Link
      href={ROUTES.estudiantes}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Volver a estudiantes
    </Link>
  );
}

async function PanoramaContent({ studentId }: { studentId: string }) {
  const data = await getStudentPanorama(studentId).catch(
    (): StudentPanoramaResponse | null => null,
  );

  if (!data) {
    return (
      <EmptyState
        icon={Inbox}
        title="No se pudo cargar el panorama"
        description="No hay resultados para este estudiante, o no tienes acceso a su curso."
      />
    );
  }

  const { student, summary, byAssessment, bySkill, byLevel } = data;
  const meta = [
    student.rut,
    student.classGroup ? `${student.classGroup.gradeName} · ${student.classGroup.name}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <div className="space-y-6">
      <SetPageTitle title={student.fullName} />

      {meta ? <p className="text-sm text-muted-foreground">{meta}</p> : null}

      <MetricsGroup
        metrics={[
          {
            label: 'Evaluaciones',
            value: String(summary.assessmentsCount),
            icon: ClipboardList,
          },
          { label: 'Logro promedio', value: formatAchievement(summary.averageAchievement) },
          {
            label: 'Habilidades evaluadas',
            value: String(summary.skillsAssessed),
            icon: Layers,
          },
        ]}
      />

      {byAssessment.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Sin evaluaciones con resultados"
          description="Este estudiante aún no tiene resultados individuales calculados."
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Evolución del % de logro</CardTitle>
            </CardHeader>
            <CardContent>
              <PanoramaTrajectory items={byAssessment} />
            </CardContent>
          </Card>

          <DistributionBar distribution={byLevel} title="Distribución por nivel de desempeño" />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Por evaluación</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Evaluación</th>
                    <th className="py-2 pr-4 font-medium">Instrumento</th>
                    <th className="py-2 pr-4 font-medium">Asignatura</th>
                    <th className="py-2 pr-4 font-medium">Fecha</th>
                    <th className="py-2 pr-4 font-medium">Nota</th>
                    <th className="py-2 pr-4 font-medium">% logro</th>
                    <th className="py-2 pr-4 font-medium">Nivel</th>
                  </tr>
                </thead>
                <tbody>
                  {byAssessment.map((a) => (
                    <tr key={a.assessmentId} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{a.assessmentName ?? '—'}</td>
                      <td className="py-2 pr-4">{a.instrumentName}</td>
                      <td className="py-2 pr-4">{a.subjectName ?? '—'}</td>
                      <td className="py-2 pr-4">{fmtDate(a.administeredAt)}</td>
                      <td className="py-2 pr-4 tabular-nums">{fmtGrade(a.grade)}</td>
                      <td className="py-2 pr-4 tabular-nums">{formatAchievement(a.achievement)}</td>
                      <td className="py-2 pr-4">
                        <PerformanceBadge level={a.performanceLevel} band={a.performanceBand} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {bySkill.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Por habilidad / eje</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Habilidad / Eje</th>
                      <th className="py-2 pr-4 font-medium">Evaluaciones</th>
                      <th className="py-2 pr-4 font-medium">% logro</th>
                      <th className="py-2 pr-4 font-medium">Nivel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bySkill.map((s) => (
                      <tr key={s.nodeId} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-medium">
                          {s.nodeName}
                          {s.nodeCode ? (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {s.nodeCode}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-4 tabular-nums">{s.assessmentsCount}</td>
                        <td className="py-2 pr-4 tabular-nums">
                          {formatAchievement(s.averageAchievement)}
                        </td>
                        <td className="py-2 pr-4">
                          <PerformanceBadge level={s.performanceLevel} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
