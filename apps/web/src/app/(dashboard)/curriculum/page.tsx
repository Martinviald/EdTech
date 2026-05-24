import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { canAccess, CURRICULUM_ROLES, userHasAnyRole, type CurriculumModel } from '@soe/types';
import { NewCurriculumButton } from './NewCurriculumButton';

const TYPE_LABELS: Record<string, string> = {
  mineduc: 'MINEDUC',
  simce: 'SIMCE',
  paes: 'PAES',
  dia: 'DIA',
  cambridge: 'Cambridge',
  aptus: 'Aptus',
  desafio: 'Desafío',
  custom: 'Personalizado',
};

export default async function CurriculumPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, CURRICULUM_ROLES)) redirect('/dashboard');

  const curricula = await apiGet<CurriculumModel[]>('/taxonomies/curricula');

  const official = curricula.filter((c) => c.isOfficial);
  const custom = curricula.filter((c) => !c.isOfficial);
  const canCreate = userHasAnyRole(session.user.roles, ['platform_admin', 'school_admin']);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Currículum</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Taxonomías, habilidades y objetivos de aprendizaje. Los currícula oficiales son de solo
            lectura; puedes crear y editar los propios de tu colegio.
          </p>
        </div>
        {canCreate && (
          <NewCurriculumButton isPlatformAdmin={session.user.role === 'platform_admin'} />
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase text-muted-foreground">Oficiales</h2>
        {official.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Aún no se han cargado currícula oficiales. El seed MINEDUC los traerá en breve.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {official.map((c) => (
              <CurriculumCard key={c.id} curriculum={c} typeLabel={TYPE_LABELS[c.type] ?? c.type} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase text-muted-foreground">De mi colegio</h2>
        {custom.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Aún no has creado currícula personalizados. Úsalos para definir un plan lector,
                escalas internas o adaptaciones.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {custom.map((c) => (
              <CurriculumCard key={c.id} curriculum={c} typeLabel={TYPE_LABELS[c.type] ?? c.type} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CurriculumCard({ curriculum, typeLabel }: { curriculum: CurriculumModel; typeLabel: string }) {
  return (
    <Link
      href={`/curriculum/${curriculum.id}` as Route}
      className="group block rounded-lg border bg-card transition-shadow hover:shadow-md"
    >
      <Card className="border-0 shadow-none">
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base leading-tight group-hover:text-primary">
              {curriculum.name}
            </CardTitle>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                curriculum.isOfficial
                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200'
                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
              }`}
            >
              {curriculum.isOfficial ? 'Oficial' : 'Custom'}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-1 text-xs text-muted-foreground">
          <div>Tipo: {typeLabel}</div>
          {curriculum.version && <div>Versión: {curriculum.version}</div>}
          <div>Idioma: {curriculum.language.toUpperCase()}</div>
        </CardContent>
      </Card>
    </Link>
  );
}
