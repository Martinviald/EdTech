import type { Route } from 'next';
import Link from 'next/link';
import { Settings } from 'lucide-react';
import { getOrg, getSubjectMatrix } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6 text-sm text-amber-900 dark:text-amber-200">
            <div>
              <p className="font-semibold">Sin año académico configurado</p>
              <p>
                El colegio aún no tiene un año vigente. Configuralo en nombre del school admin
                para habilitar cursos, asignaturas y carga de alumnos.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/colegios/${id}/configurar` as Route}>
                <Settings className="mr-2 size-4" />
                Configurar año académico
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Comuna" value={org.commune ?? '—'} />
        <SummaryCard label="Región" value={org.region ?? '—'} />
        <SummaryCard label="Miembros" value={String(org.membershipCount)} />
      </div>

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

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="text-lg font-semibold">{value}</CardContent>
    </Card>
  );
}
