import { Suspense } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { ArrowRight, BarChart3, FileUp, Lightbulb, Sparkles } from 'lucide-react';
import {
  canAccess,
  IMPORT_ROLES,
  RESULTS_VIEWER_ROLES,
  AI_ANALYSIS_VIEWER_ROLES,
  REMEDIAL_VIEWER_ROLES,
  type UserRole,
} from '@soe/types';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CardSkeleton, MetricsGroup } from '@/components/shared';
import { ROLE_LABELS } from '@/components/layout/nav-items';
import { RecentAssessmentsCard } from './components/recent-assessments-card';
import { OnboardingChecklist, type OnboardingStep } from './components/onboarding-checklist';
import {
  getAssessments,
  getClassGroupsForUser,
  getInstrumentsTotal,
  getOrgOverview,
} from './data';

export const dynamic = 'force-dynamic';

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
      <h1 className="text-2xl font-semibold tracking-tight">
        Hola, <span className="text-primary">{user.name ?? 'bienvenido'}</span>
      </h1>
      <p className="text-sm text-muted-foreground">{roleLabel}</p>
    </header>
  );

  // La vista del profesor se decide por el rol ACTIVO (no la unión), para que un
  // usuario admin+profesor pueda alternar — coherente con shouldShowTeacherView.
  const isTeacherView = user.activeRole === 'teacher' || user.activeRole === 'homeroom_teacher';

  if (isTeacherView) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        {greeting}
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-medium">Mis cursos</h2>
              <Button asChild variant="ghost" size="sm">
                <Link href={ROUTES.myClasses}>
                  Ver todos <ArrowRight className="ml-1.5 size-3.5" aria-hidden />
                </Link>
              </Button>
            </div>
            <Suspense fallback={<ClassesGridSkeleton />}>
              <TeacherClassesGrid orgId={orgId} />
            </Suspense>
          </div>
          <Suspense fallback={<CardSkeleton rows={4} />}>
            <TeacherRecentAssessments />
          </Suspense>
        </section>
      </div>
    );
  }

  // Vista directivo / coordinador de evaluación.
  const canImport = canAccess(user.roles, IMPORT_ROLES);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      {greeting}

      <Suspense fallback={<Skeleton className="h-[92px] w-full rounded-xl" />}>
        <DirectorMetrics />
      </Suspense>

      <Suspense fallback={null}>
        <DirectorOnboarding canImport={canImport} />
      </Suspense>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense fallback={<CardSkeleton rows={5} />}>
            <DirectorRecentAssessments />
          </Suspense>
        </div>
        <QuickAccess roles={user.roles} canImport={canImport} />
      </section>
    </div>
  );
}

async function TeacherClassesGrid({ orgId }: { orgId: string }) {
  const classRows = await getClassGroupsForUser(orgId);
  const classes = dedupeClasses(classRows).slice(0, 6);

  if (classes.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Aún no tienes cursos asignados. Contacta a tu coordinador para que te asigne carga.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {classes.map((c) => (
        <Link
          key={c.classGroupId}
          href={ROUTES.myClass(c.classGroupId)}
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
  );
}

async function TeacherRecentAssessments() {
  const assessments = await getAssessments();
  const recent = assessments?.data.slice(0, 6) ?? [];
  return (
    <RecentAssessmentsCard
      assessments={recent}
      emptyDescription="Cuando se importen resultados de tus cursos, aparecerán aquí."
    />
  );
}

async function DirectorMetrics() {
  const [overview, assessments] = await Promise.all([getOrgOverview(), getAssessments()]);
  const assessmentsTotal = assessments?.data.length ?? 0;

  return (
    <MetricsGroup
      metrics={[
        { label: 'Evaluaciones', value: String(assessmentsTotal) },
        { label: 'Cursos', value: String(overview?.classGroupCount ?? 0) },
        {
          label: 'Año académico',
          value: String(overview?.academicYear?.year ?? new Date().getFullYear()),
        },
      ]}
    />
  );
}

async function DirectorOnboarding({ canImport }: { canImport: boolean }) {
  if (!canImport) return null;

  const [overview, assessments, instruments] = await Promise.all([
    getOrgOverview(),
    getAssessments(),
    getInstrumentsTotal(),
  ]);

  const assessmentsTotal = assessments?.data.length ?? 0;
  const yearDone = overview?.isSetupComplete ?? false;
  const instrumentDone = (instruments?.total ?? 0) > 0;
  const resultsDone = assessmentsTotal > 0;
  const showOnboarding = !(yearDone && instrumentDone && resultsDone);
  if (!showOnboarding) return null;

  const steps: OnboardingStep[] = [
    {
      title: 'Configura tu colegio',
      description: 'Año académico, ciclos, cursos y nómina de alumnos.',
      done: yearDone,
      href: ROUTES.organizacionConfigurar,
      cta: 'Configurar',
    },
    {
      title: 'Carga la pauta del instrumento',
      description: 'Importa la pauta oficial para poder corregir las respuestas.',
      done: instrumentDone,
      href: ROUTES.importarInstrumento,
      cta: 'Cargar pauta',
    },
    {
      title: 'Importa los resultados',
      description: 'Sube las hojas de respuesta y calcula los resultados por alumno y habilidad.',
      done: resultsDone,
      href: ROUTES.importarResultados,
      cta: 'Importar',
    },
  ];

  return <OnboardingChecklist steps={steps} />;
}

async function DirectorRecentAssessments() {
  const assessments = await getAssessments();
  const recent = assessments?.data.slice(0, 6) ?? [];
  return <RecentAssessmentsCard assessments={recent} />;
}

function ClassesGridSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-[74px] w-full rounded-lg" />
      ))}
    </div>
  );
}

function QuickAccess({ roles, canImport }: { roles: readonly UserRole[]; canImport: boolean }) {
  const links: { href: Route; label: string; icon: typeof BarChart3; show: boolean }[] = [
    {
      href: ROUTES.resultados,
      label: 'Panorama pedagógico',
      icon: BarChart3,
      show: canAccess(roles, RESULTS_VIEWER_ROLES),
    },
    {
      href: ROUTES.analisisIa,
      label: 'Análisis IA',
      icon: Sparkles,
      show: canAccess(roles, AI_ANALYSIS_VIEWER_ROLES),
    },
    {
      href: ROUTES.materialRemedial,
      label: 'Material remedial',
      icon: Lightbulb,
      show: canAccess(roles, REMEDIAL_VIEWER_ROLES),
    },
    { href: ROUTES.importarResultados, label: 'Importar resultados', icon: FileUp, show: canImport },
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
              <Link href={l.href}>
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
