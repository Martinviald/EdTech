import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CardSkeleton } from '@/components/shared';
import { Skeleton } from '@/components/ui/skeleton';
import {
  canAccess,
  TAXONOMY_ROLES,
  TAXONOMY_KIND_ORDER,
  TAXONOMY_KIND_GROUP_LABEL,
  taxonomyKind,
  userHasAnyRole,
  type TaxonomyKind,
  type TaxonomyModel,
} from '@soe/types';
import { NewTaxonomyButton } from './NewTaxonomyButton';

const GROUP_DESCRIPTION: Record<TaxonomyKind, string> = {
  curriculum: 'Currículum nacional del MINEDUC: ejes y objetivos de aprendizaje. Solo lectura.',
  evaluacion: 'Marcos de pruebas estandarizadas (DIA, SIMCE, PAES): habilidades y ejes que evalúan.',
  externo: 'Programas y certificaciones externas (Cambridge, Aptus, Desafío).',
  propio: 'Marcos creados por tu colegio: plan lector, escalas internas, adaptaciones.',
};

const CHIP_CLASS: Record<TaxonomyKind, string> = {
  curriculum: 'bg-info/10 text-info',
  evaluacion: 'bg-primary/10 text-primary',
  externo: 'bg-warning/15 text-warning',
  propio: 'bg-success/10 text-success',
};

export default async function MarcosAcademicosPage() {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, TAXONOMY_ROLES)) redirect(ROUTES.dashboard);

  const canCreate = userHasAnyRole(session.user.roles, ['platform_admin', 'school_admin']);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Marcos Académicos</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Currículum, marcos de evaluación y taxonomías de habilidades contra los que se etiquetan
            las preguntas. Los marcos oficiales son de solo lectura; puedes crear y editar los
            propios de tu colegio.
          </p>
        </div>
        {canCreate && (
          <NewTaxonomyButton isPlatformAdmin={session.user.role === 'platform_admin'} />
        )}
      </div>

      <Suspense fallback={<TaxonomyGroupsSkeleton />}>
        <TaxonomyGroups />
      </Suspense>
    </div>
  );
}

async function TaxonomyGroups() {
  const taxonomies = await apiGet<TaxonomyModel[]>('/taxonomies');

  const byKind = new Map<TaxonomyKind, TaxonomyModel[]>();
  for (const t of taxonomies) {
    const { kind } = taxonomyKind(t.type, t.isOfficial);
    byKind.set(kind, [...(byKind.get(kind) ?? []), t]);
  }

  return (
    <>
      {TAXONOMY_KIND_ORDER.map((kind) => {
        const items = byKind.get(kind) ?? [];
        // El grupo "Propio del colegio" se muestra siempre (invita a crear); el
        // resto solo si tiene marcos cargados.
        if (items.length === 0 && kind !== 'propio') return null;
        return (
          <section key={kind} className="space-y-3">
            <div>
              <h2 className="text-sm font-medium uppercase text-muted-foreground">
                {TAXONOMY_KIND_GROUP_LABEL[kind]}
              </h2>
              <p className="text-xs text-muted-foreground">{GROUP_DESCRIPTION[kind]}</p>
            </div>
            {items.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">
                    Aún no has creado marcos propios. Úsalos para definir un plan lector, escalas
                    internas o adaptaciones.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {items.map((t) => (
                  <TaxonomyCard key={t.id} taxonomy={t} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

function TaxonomyGroupsSkeleton() {
  return (
    <>
      {Array.from({ length: 2 }).map((_, section) => (
        <section key={section} className="space-y-3">
          <Skeleton className="h-4 w-48" />
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, card) => (
              <CardSkeleton key={card} rows={2} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function TaxonomyCard({ taxonomy }: { taxonomy: TaxonomyModel }) {
  const { kind, typeLabel } = taxonomyKind(taxonomy.type, taxonomy.isOfficial);
  return (
    <Link
      href={ROUTES.marcoAcademico(taxonomy.id)}
      className="group block rounded-lg border bg-card transition-shadow hover:shadow-md"
    >
      <Card className="border-0 shadow-none">
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base leading-tight group-hover:text-primary">
              {taxonomy.name}
            </CardTitle>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${CHIP_CLASS[kind]}`}
            >
              {taxonomy.isOfficial ? typeLabel : 'Propio'}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-1 text-xs text-muted-foreground">
          <div>Tipo: {typeLabel}</div>
          {taxonomy.version && <div>Versión: {taxonomy.version}</div>}
          <div>Idioma: {taxonomy.language.toUpperCase()}</div>
        </CardContent>
      </Card>
    </Link>
  );
}
