import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const DEPENDENCE_LABELS: Record<string, string> = {
  municipal: 'Municipal',
  particular_pagado: 'Particular Pagado',
  particular_subvencionado: 'Particular Subvencionado',
  delegada: 'Corporación Delegada',
};

type OrgOverview = {
  org: {
    id: string;
    name: string;
    rbd: string | null;
    commune: string | null;
    region: string | null;
    dependence: string | null;
  };
  academicYear: { id: string; year: number } | null;
  classGroupCount: number;
  isSetupComplete: boolean;
};

export default async function OrganizacionPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect('/login');

  const overview = await apiGet<OrgOverview>('/organizations/me/overview');
  const { org, classGroupCount, isSetupComplete, academicYear } = overview;

  const currentYear = new Date().getFullYear();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{org.name}</h1>
          <p className="text-muted-foreground mt-1 text-sm">Perfil institucional</p>
        </div>
        {!isSetupComplete && (
          <Button asChild variant="outline">
            <Link href={'/organizacion/configurar' as Route}>Completar configuración</Link>
          </Button>
        )}
      </div>

      {!isSetupComplete && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20">
          <CardContent className="pt-4">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              La configuración del año académico {currentYear} aún no está completa. Ingresa los
              ciclos, cursos y asignaturas para comenzar a usar la plataforma.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Información básica</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="RBD" value={org.rbd ?? '—'} />
            <Row
              label="Dependencia"
              value={org.dependence ? (DEPENDENCE_LABELS[org.dependence] ?? org.dependence) : '—'}
            />
            <Row label="Comuna" value={org.commune ?? '—'} />
            <Row label="Región" value={org.region ?? '—'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Año académico {academicYear?.year ?? currentYear}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {isSetupComplete ? (
              <Row label="Cursos configurados" value={String(classGroupCount)} />
            ) : (
              <p className="text-muted-foreground">Sin configurar</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
