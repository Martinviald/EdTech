import { Suspense } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { ArrowLeft, ArrowRight, ClipboardList, Inbox, Layers } from 'lucide-react';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  RESULTS_VIEWER_ROLES,
  type StudentPanoramaAssessment,
  type StudentPanoramaResponse,
} from '@soe/types';
import { PageContainer, EmptyState, CardSkeleton, MetricsGroup } from '@/components/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SetPageTitle } from '@/components/layout/page-title-context';
import { PerformanceBadge } from '../../resultados/components/performance-badge';
import { formatAchievement } from '../../resultados/components/performance-level';
import { PanoramaTrajectory } from '../components/panorama-trajectory';
import { PanoramaDistribution } from '../components/panorama-distribution';
import { SkillTree } from '../components/skill-tree';
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

function achievementHint(withAchievement: number, total: number): string | undefined {
  if (total === 0 || withAchievement === total) return undefined;
  if (withAchievement === 0) {
    return `Ninguna de sus ${total} evaluaciones entrega % de logro: sólo nivel de desempeño.`;
  }
  return `Sobre ${withAchievement} de ${total} evaluaciones — el resto sólo entrega nivel.`;
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

function BandMovement({ item }: { item: StudentPanoramaAssessment }) {
  if (!item.priorPerformanceBand || !item.performanceBand) {
    return <PerformanceBadge level={item.performanceLevel} band={item.performanceBand} />;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{item.priorPerformanceBand.label}</span>
      <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
      <PerformanceBadge level={item.performanceLevel} band={item.performanceBand} />
    </span>
  );
}

function ResponsesLink({
  item,
  studentId,
}: {
  item: StudentPanoramaAssessment;
  studentId: string;
}) {
  if (item.dataGranularity !== 'item_level') {
    return (
      <span className="text-xs text-muted-foreground">Sólo nivel — sin detalle por pregunta</span>
    );
  }
  return (
    <Link
      href={
        `${ROUTES.evaluacionInformeAlumno(item.assessmentId, studentId)}?volver=estudiante` as Route
      }
      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
    >
      Ver respuestas
      <ArrowRight className="size-3.5" aria-hidden />
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

  const { student, summary, byAssessment, bySkillTree, distribution } = data;
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
          {
            label: 'Logro promedio',
            value: formatAchievement(summary.averageAchievement),
            hint: achievementHint(summary.assessmentsWithAchievement, summary.assessmentsCount),
          },
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

          <PanoramaDistribution distribution={distribution} />

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
                    <th className="py-2 pr-4 font-medium">Respuestas</th>
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
                      <td className="py-2 pr-4 tabular-nums">
                        {a.achievement === null ? (
                          <span
                            className="text-muted-foreground"
                            title="Informe agregado: entrega el nivel del alumno, no su porcentaje"
                          >
                            —
                          </span>
                        ) : (
                          formatAchievement(a.achievement)
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        <BandMovement item={a} />
                      </td>
                      <td className="py-2 pr-4">
                        <ResponsesLink item={a} studentId={studentId} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {bySkillTree.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Por eje, habilidad y OA</CardTitle>
              </CardHeader>
              <CardContent>
                <SkillTree nodes={bySkillTree} />
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
