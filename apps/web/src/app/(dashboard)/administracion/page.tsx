import type { Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader } from '@/components/shared';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  accessibleHubOptions,
  ADMIN_HUB_OPTIONS,
  type AdminHubOption,
} from '@/components/layout/admin-hub';

/**
 * Hub de Administración: reúne las vistas de gestión que ya no cuelgan del
 * sidebar (colegio, equipo, alumnos, marcos académicos y configuración). Cada
 * una conserva su ruta propia; acá sólo se listan las accesibles según el rol.
 */
export default async function AdministracionPage() {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);

  const options = accessibleHubOptions(
    ADMIN_HUB_OPTIONS,
    session.user.roles,
    Boolean(session.user.isPlatformAdmin),
  );
  if (options.length === 0) redirect(ROUTES.dashboard);

  return (
    <PageContainer>
      <PageHeader
        title="Administración"
        description="Gestión del colegio, del equipo y de la configuración de la plataforma."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((option) => (
          <OptionCard key={option.href} option={option} />
        ))}
      </div>
    </PageContainer>
  );
}

function OptionCard({ option }: { option: AdminHubOption }) {
  const Icon = option.icon;
  const isSoon = option.status === 'soon';

  const card = (
    <Card
      className={cn(
        'h-full transition-colors duration-fast',
        isSoon ? 'opacity-60' : 'group-hover:border-primary/50 group-hover:bg-muted/40',
      )}
    >
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className={cn('size-5', isSoon ? 'text-muted-foreground' : 'text-primary')} />
          <CardTitle className="text-base">{option.label}</CardTitle>
          {isSoon ? (
            <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Próx.
            </span>
          ) : null}
        </div>
        <CardDescription>{option.description}</CardDescription>
      </CardHeader>
    </Card>
  );

  if (isSoon) {
    return <div aria-disabled="true">{card}</div>;
  }

  return (
    <Link
      href={option.href as Route}
      className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {card}
    </Link>
  );
}
