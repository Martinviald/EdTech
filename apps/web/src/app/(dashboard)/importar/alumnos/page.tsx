import { redirect } from 'next/navigation';
import { Download } from 'lucide-react';
import { canAccess, IMPORT_ROLES } from '@soe/types';
import { auth } from '@/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StudentImportFlow } from '@/components/import/student-import-flow';
import { PageContainer, PageHeader } from '@/components/shared';
import { ROUTES } from '@/lib/routes';

export default async function ImportarPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, IMPORT_ROLES)) {
    redirect(ROUTES.dashboard);
  }

  return (
    <PageContainer>
      <PageHeader
        title="Importar alumnos"
        description="Sube tu nómina en formato CSV. El sistema validará cada fila y te dará un resumen antes de confirmar."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Descarga la plantilla</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Usa este archivo de ejemplo con las columnas exactas que esperamos:{' '}
            <code className="bg-muted rounded px-1 py-0.5">RUT</code>,{' '}
            <code className="bg-muted rounded px-1 py-0.5">Nombres</code>,{' '}
            <code className="bg-muted rounded px-1 py-0.5">Apellidos</code>,{' '}
            <code className="bg-muted rounded px-1 py-0.5">Curso</code>.
          </p>
          <Button asChild variant="outline" size="sm">
            <a href="/plantilla_alumnos.csv" download>
              <Download className="mr-2 h-4 w-4" />
              Descargar plantilla_alumnos.csv
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Sube tu nómina</CardTitle>
        </CardHeader>
        <CardContent>
          <StudentImportFlow />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
