import Link from 'next/link';
import { Settings } from 'lucide-react';
import { getOrg, getSubjectMatrix } from '@/lib/adminApi';
import { ROUTES } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricsGroup } from '@/components/shared';
import { ProfileForm } from './ProfileForm';

export const dynamic = 'force-dynamic';

export default async function AdminOrgProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [org, matrix] = await Promise.all([getOrg(id), getSubjectMatrix(id)]);
  const needsSetup = org.type === 'school' && matrix.academicYear === null;

  return (
    <div className="space-y-6">
      {needsSetup ? (
        <Card className="border-warning/30 bg-warning/15">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6 text-sm text-warning">
            <div>
              <p className="font-semibold">Sin año académico configurado</p>
              <p>
                El colegio aún no tiene un año vigente. Configuralo en nombre del school admin
                para habilitar cursos, asignaturas y carga de alumnos.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href={ROUTES.adminColegioConfigurar(id)}>
                <Settings className="mr-2 size-4" />
                Configurar año académico
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <MetricsGroup
        metrics={[
          { label: 'Comuna', value: org.commune ?? '—' },
          { label: 'Región', value: org.region ?? '—' },
          { label: 'Miembros', value: String(org.membershipCount) },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Perfil del colegio</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm org={org} />
        </CardContent>
      </Card>
    </div>
  );
}

