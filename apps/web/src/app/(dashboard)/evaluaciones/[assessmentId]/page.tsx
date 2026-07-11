import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import {
  ArrowRight,
  CheckCircle2,
  GraduationCap,
  Lightbulb,
  ShieldCheck,
  Sparkles,
  Table2,
  Target,
  Users,
} from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  DASHBOARD_VIEWER_ROLES,
  ANALYTICS_VIEWER_ROLES,
  ITEM_ANALYSIS_VIEWER_ROLES,
  AI_ANALYSIS_VIEWER_ROLES,
  REMEDIAL_VIEWER_ROLES,
  INSTRUMENT_QUALITY_VIEWER_ROLES,
  type AssessmentReportResponse,
  type UserRole,
} from '@soe/types';
import { EmptyState } from '@/components/patterns';
import { Card, CardContent } from '@/components/ui/card';
import { SummaryCard } from '../../resultados/components/summary-card';
import {
  formatAchievement,
  performanceLevelLabel,
} from '../../resultados/components/performance-level';

export const dynamic = 'force-dynamic';

function pickParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

type SectionLink = {
  href: string;
  label: string;
  description: string;
  icon: typeof Sparkles;
  policy: readonly UserRole[];
};

export default async function EvaluacionResumenPage({
  params,
  searchParams,
}: {
  params: Promise<{ assessmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, DASHBOARD_VIEWER_ROLES)) redirect('/dashboard');

  const { assessmentId } = await params;
  const sp = await searchParams;
  const classGroupId = pickParam(sp.classGroupId);
  const suffix = classGroupId ? `?classGroupId=${classGroupId}` : '';

  const query = new URLSearchParams({ assessmentId });
  if (classGroupId) query.set('classGroupId', classGroupId);

  let report: AssessmentReportResponse | null = null;
  try {
    report = await apiGet<AssessmentReportResponse>(
      `/analytics/assessment-report?${query.toString()}`,
    );
  } catch {
    report = null;
  }

  if (!report) {
    return (
      <div className="space-y-6">
        <EmptyState
          icon={Table2}
          title="No se pudo cargar el resumen"
          description="No tienes acceso a esta evaluación o no existe para el curso seleccionado. Verifica que tengas asignados los cursos de la evaluación."
        />
      </div>
    );
  }

  const { summary } = report;
  const base = `/evaluaciones/${assessmentId}`;
  const roles = session.user.roles;

  const sections: SectionLink[] = [
    {
      href: `${base}/resultados`,
      label: 'Resultados',
      description: 'Informe consolidado: síntesis, comparativa por curso, habilidades e ítems.',
      icon: Target,
      policy: ANALYTICS_VIEWER_ROLES,
    },
    {
      href: `${base}/detalle`,
      label: 'Detalle por pregunta',
      description: 'Tabla cruzada alumno × pregunta con distractores.',
      icon: Table2,
      policy: ITEM_ANALYSIS_VIEWER_ROLES,
    },
    {
      href: `${base}/analisis-ia`,
      label: 'Análisis IA',
      description: 'Informe pedagógico generado por IA con brechas y recomendaciones.',
      icon: Sparkles,
      policy: AI_ANALYSIS_VIEWER_ROLES,
    },
    {
      href: `${base}/material-remedial`,
      label: 'Material remedial',
      description: 'Material remedial generado para las brechas de esta evaluación.',
      icon: Lightbulb,
      policy: REMEDIAL_VIEWER_ROLES,
    },
    {
      href: `${base}/calidad`,
      label: 'Calidad del instrumento',
      description: 'Confiabilidad (KR-20) y banderas psicométricas de los ítems.',
      icon: ShieldCheck,
      policy: INSTRUMENT_QUALITY_VIEWER_ROLES,
    },
  ];

  const visibleSections = sections.filter((s) => canAccess(roles, s.policy));

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="% Logro promedio"
          value={formatAchievement(summary.averageAchievement)}
          hint={`Nivel: ${performanceLevelLabel(summary.performanceLevel)}`}
          icon={Target}
        />
        <SummaryCard
          label="Aprobación"
          value={summary.passingRate === null ? '—' : `${summary.passingRate.toFixed(1)}%`}
          hint={`Nota de corte: ${summary.passingGrade.toFixed(1)}`}
          icon={CheckCircle2}
        />
        <SummaryCard
          label="Nota promedio"
          value={summary.averageGrade === null ? '—' : summary.averageGrade.toFixed(1)}
          hint={summary.averageGrade === null ? undefined : 'Promedio del curso evaluado'}
          icon={GraduationCap}
        />
        <SummaryCard
          label="Asistencia"
          value={`${summary.studentsEvaluated}/${summary.studentsEnrolled}`}
          hint={
            summary.coverageRate === null
              ? 'Alumnos evaluados'
              : `${summary.coverageRate.toFixed(0)}% de los matriculados`
          }
          icon={Users}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleSections.map((s) => (
          <Link
            key={s.href}
            href={`${s.href}${suffix}` as Route}
            className="group rounded-lg outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Card className="h-full transition-colors group-hover:border-primary">
              <CardContent className="flex h-full flex-col gap-2 p-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="rounded-lg bg-muted p-2">
                      <s.icon className="size-5 text-muted-foreground" aria-hidden />
                    </div>
                    <h2 className="text-base font-semibold">{s.label}</h2>
                  </div>
                  <ArrowRight
                    className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                    aria-hidden
                  />
                </div>
                <p className="text-sm text-muted-foreground">{s.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  );
}
