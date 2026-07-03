import Link from 'next/link';
import type { Route } from 'next';
import { ArrowRight, BarChart3, FileUp, Lightbulb, Sparkles } from 'lucide-react';
import {
  canAccess,
  IMPORT_ROLES,
  RESULTS_VIEWER_ROLES,
  AI_ANALYSIS_VIEWER_ROLES,
  REMEDIAL_VIEWER_ROLES,
  type AssessmentListResponse,
  type UserRole,
} from '@soe/types';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { listClassGroupsForUser } from '@/lib/teacherAssignmentsApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ROLE_LABELS } from '@/components/layout/nav-items';
import { RecentAssessmentsCard } from './components/recent-assessments-card';
import { OnboardingChecklist, type OnboardingStep } from './components/onboarding-checklist';

export const dynamic = 'force-dynamic';

type OrgOverview = {
  isSetupComplete: boolean;
  classGroupCount: number;
  academicYear: { year: number } | null;
};

type ClassCard = {
  classGroupId: string;
  className: string;
  gradeShortName: string;
  academicYear: number;
};

export default async function DashboardPage() {
  const session = await auth();
  const user = session?.user;
  if (!user?.orgId) return null;
  const orgId = user.orgId;
  const roleLabel = ROLE_LABELS[user.activeRole] ?? user.activeRole;

  const greeting = (
    <header className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">Hola, {user.name ?? 'bienvenido'}</h1>
      <p className="text-sm text-muted-foreground">{roleLabel}</p>
    </header>
  );

  // La vista del profesor se decide por el rol ACTIVO (no la unión), para que un
  // usuario admin+profesor pueda alternar — coherente con shouldShowTeacherView.
  const isTeacherView = user.activeRole === 'teacher' || user.activeRole === 'homeroom_teacher';

  if (isTeacherView) {
    const [classRows, assessments] = await Promise.all([
      listClassGroupsForUser(orgId).catch(() => []),
      apiGet<AssessmentListResponse>('/item-analysis/assessments').catch(() => null),
    ]);

    const classes = dedupeClasses(classRows).slice(0, 6);
    const recent = assessments?.data.slice(0, 6) ?? [];

    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        {greeting}
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-medium">Mis cursos</h2>
              <Button asChild variant="ghost" size="sm">
                <Link href={'/dashboard/my-classes' as Route}>
                  Ver todos <ArrowRight className="ml-1.5 size-3.5" aria-hidden />
                </Link>
              </Button>
            </div>
            {classes.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                  Aún no tienes cursos asignados. Contacta a tu coordinador para que te asigne
                  carga.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {classes.map((c) => (
                  <Link
                    key={c.classGroupId}
                    href={`/dashboard/my-classes/${c.classGroupId}` as Route}
                    className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <Card className="h-full transition-colors hover:bg-muted/30">
                      <CardContent className="p-4">
                        <p className="text-sm font-medium">
                          {c.gradeShortName} · {c.className}
                        </p>
                        <p className="text-xs text-muted-foreground">Año {c.academicYear}</p>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <RecentAssessmentsCard
            assessments={recent}
            emptyDescription="Cuando se importen resultados de tus cursos, aparecerán aquí."
          />
        </section>
      </div>
    );
  }

  // Vista directivo / coordinador de evaluación.
  const canImport = canAccess(user.roles, IMPORT_ROLES);
  const [overview, assessments, instruments] = await Promise.all([
    apiGet<OrgOverview>('/organizations/me/overview').catch(() => null),
    apiGet<AssessmentListResponse>('/item-analysis/assessments').catch(() => null),
    canImport
      ? apiGet<{ total: number }>('/instruments?limit=1').catch(() => null)
      : Promise.resolve(null),
  ]);

  const recent = assessments?.data.slice(0, 6) ?? [];
  const assessmentsTotal = assessments?.data.length ?? 0;
  const yearDone = overview?.isSetupComplete ?? false;
  const instrumentDone = (instruments?.total ?? 0) > 0;
  const resultsDone = assessmentsTotal > 0;
  const showOnboarding = canImport && !(yearDone && instrumentDone && resultsDone);

  const steps: OnboardingStep[] = [
    {
      title: 'Configura tu colegio',
      description: 'Año académico, ciclos, cursos y nómina de alumnos.',
      done: yearDone,
      href: '/organizacion/configurar',
      cta: 'Configurar',
    },
    {
      title: 'Carga la pauta del instrumento',
      description: 'Importa la pauta oficial para poder corregir las respuestas.',
      done: instrumentDone,
      href: '/importar/instrumento',
      cta: 'Cargar pauta',
    },
    {
      title: 'Importa los resultados',
      description: 'Sube las hojas de respuesta y calcula los resultados por alumno y habilidad.',
      done: resultsDone,
      href: '/importar/resultados',
      cta: 'Importar',
    },
  ];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      {greeting}

      <section className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Evaluaciones" value={assessmentsTotal} />
        <Kpi label="Cursos" value={overview?.classGroupCount ?? 0} />
        <Kpi
          label="Año académico"
          value={overview?.academicYear?.year ?? new Date().getFullYear()}
        />
      </section>

      {showOnboarding ? <OnboardingChecklist steps={steps} /> : null}

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentAssessmentsCard assessments={recent} />
        </div>
        <QuickAccess roles={user.roles} canImport={canImport} />
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function QuickAccess({ roles, canImport }: { roles: readonly UserRole[]; canImport: boolean }) {
  const links: { href: string; label: string; icon: typeof BarChart3; show: boolean }[] = [
    {
      href: '/resultados',
      label: 'Ver resultados',
      icon: BarChart3,
      show: canAccess(roles, RESULTS_VIEWER_ROLES),
    },
    {
      href: '/analisis-ia',
      label: 'Análisis IA',
      icon: Sparkles,
      show: canAccess(roles, AI_ANALYSIS_VIEWER_ROLES),
    },
    {
      href: '/material-remedial',
      label: 'Material remedial',
      icon: Lightbulb,
      show: canAccess(roles, REMEDIAL_VIEWER_ROLES),
    },
    { href: '/importar/resultados', label: 'Importar resultados', icon: FileUp, show: canImport },
  ];
  const visible = links.filter((l) => l.show);
  if (visible.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Accesos rápidos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {visible.map((l) => {
          const Icon = l.icon;
          return (
            <Button key={l.href} asChild variant="outline" className="w-full justify-start">
              <Link href={l.href as Route}>
                <Icon className="mr-2 size-4" aria-hidden />
                {l.label}
              </Link>
            </Button>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** Colapsa las filas (curso × asignatura) a tarjetas únicas por curso. */
function dedupeClasses(
  rows: Array<{
    classGroupId: string;
    className: string;
    gradeShortName: string;
    academicYear: number;
  }>,
): ClassCard[] {
  const byId = new Map<string, ClassCard>();
  for (const r of rows) {
    if (!byId.has(r.classGroupId)) {
      byId.set(r.classGroupId, {
        classGroupId: r.classGroupId,
        className: r.className,
        gradeShortName: r.gradeShortName,
        academicYear: r.academicYear,
      });
    }
  }
  return [...byId.values()];
}
