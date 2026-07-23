import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { ArrowRight, ClipboardList, Lock, Upload, Users } from 'lucide-react';
import {
  canAccess,
  IMPORT_ROLES,
  ITEM_BANK_ROLES,
  ANSWER_SHEET_IMPORT_ROLES,
  type UserRole,
} from '@soe/types';
import { auth } from '@/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/shared';
import { ROUTES } from '@/lib/routes';

export const dynamic = 'force-dynamic';

type Step = {
  n: number;
  href: Route;
  title: string;
  description: string;
  icon: typeof Users;
  roles: readonly UserRole[];
};

const STEPS: Step[] = [
  {
    n: 1,
    href: ROUTES.importarAlumnos,
    title: 'Nómina de alumnos',
    description: 'Carga el listado de alumnos por curso desde un CSV. Base de todo lo demás.',
    icon: Users,
    roles: IMPORT_ROLES,
  },
  {
    n: 2,
    href: ROUTES.importarInstrumento,
    title: 'Pauta / Instrumento',
    description:
      'Importa la pauta oficial del instrumento (ítems, claves y habilidades) para poder corregir.',
    icon: ClipboardList,
    roles: ITEM_BANK_ROLES,
  },
  {
    n: 3,
    href: ROUTES.importarResultados,
    title: 'Resultados (hojas de respuesta)',
    description:
      'Sube las respuestas de los alumnos. Requiere tener la pauta cargada. Crea la evaluación y calcula resultados.',
    icon: Upload,
    roles: ANSWER_SHEET_IMPORT_ROLES,
  },
];

export default async function ImportarHubPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect(ROUTES.login);
  // El hub es accesible para cualquiera que pueda hacer al menos una de las cargas.
  if (!canAccess(session.user.roles, ANSWER_SHEET_IMPORT_ROLES)) {
    redirect(ROUTES.dashboard);
  }

  const roles = session.user.roles;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Importar"
        description="Sigue los pasos en orden para poner en marcha una evaluación: primero la nómina, luego la pauta del instrumento y al final las hojas de respuesta."
      />

      <ol className="space-y-3">
        {STEPS.map((step) => {
          const Icon = step.icon;
          const allowed = canAccess(roles, step.roles);
          return (
            <li key={step.href}>
              <Card
                className={allowed ? 'transition-colors hover:border-primary/50' : 'opacity-70'}
              >
                <CardContent className="flex items-start gap-4 p-5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold tabular-nums">
                    {step.n}
                  </span>
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                    <Icon className="size-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-medium">{step.title}</h2>
                    <p className="text-muted-foreground mt-1 text-sm">{step.description}</p>
                  </div>
                  {allowed ? (
                    <Button asChild size="sm" className="shrink-0 self-center">
                      <Link href={step.href}>
                        Ir <ArrowRight className="ml-1.5 size-3.5" aria-hidden />
                      </Link>
                    </Button>
                  ) : (
                    <span
                      className="text-muted-foreground flex shrink-0 items-center gap-1 self-center text-xs"
                      title="No tienes permiso para este paso"
                    >
                      <Lock className="size-3.5" aria-hidden />
                      Sin acceso
                    </span>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
