import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  curriculum: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  evaluacion: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  externo: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  propio: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
};

export default async function MarcosAcademicosPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, TAXONOMY_ROLES)) redirect('/dashboard');

  const taxonomies = await apiGet<TaxonomyModel[]>('/taxonomies');
  const canCreate = userHasAnyRole(session.user.roles, ['platform_admin', 'school_admin']);

  const byKind = new Map<TaxonomyKind, TaxonomyModel[]>();
  for (const t of taxonomies) {
    const { kind } = taxonomyKind(t.type, t.isOfficial);
    byKind.set(kind, [...(byKind.get(kind) ?? []), t]);
  }

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
    </div>
  );
}

function TaxonomyCard({ taxonomy }: { taxonomy: TaxonomyModel }) {
  const { kind, typeLabel } = taxonomyKind(taxonomy.type, taxonomy.isOfficial);
  return (
    <Link
      href={`/marcos-academicos/${taxonomy.id}` as Route}
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
