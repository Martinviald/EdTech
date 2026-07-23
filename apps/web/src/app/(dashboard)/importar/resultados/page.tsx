import { redirect } from 'next/navigation';
import { Info } from 'lucide-react';
import {
  ANSWER_SHEET_IMPORT_ROLES,
  canAccess,
  type AnswerSheetTemplate,
} from '@soe/types';
import { auth } from '@/auth';
import { Card, CardContent } from '@/components/ui/card';
import { PageContainer, PageHeader } from '@/components/shared';
import { ROUTES } from '@/lib/routes';
import { listTemplatesAction } from './actions';
import { FormatCard } from './components/format-card';

export default async function ImportarResultadosPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, ANSWER_SHEET_IMPORT_ROLES)) {
    redirect(ROUTES.dashboard);
  }

  const templatesResult = await listTemplatesAction();
  const templates: AnswerSheetTemplate[] = templatesResult.ok
    ? templatesResult.data
    : [];
  const templatesError = templatesResult.ok ? null : templatesResult.message;

  return (
    <PageContainer>
      <PageHeader
        title="Importar resultados"
        description="Sube hojas de respuesta en formato DIA oficial, Gradecam, ZipGrade o un CSV genérico. El sistema parseará el archivo, hará match con tus alumnos y calculará los resultados."
      />

      <Card>
        <CardContent className="flex items-start gap-3 pt-6 text-sm">
          <Info className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">Antes de empezar</p>
            <ul className="text-muted-foreground list-disc space-y-0.5 pl-5">
              <li>
                Verifica que la pauta del instrumento (DIA) ya esté importada
                desde la sección{' '}
                <span className="font-medium">Importar pauta DIA</span>.
              </li>
              <li>
                Asegúrate de que tus alumnos estén cargados en la nómina y
                tengan RUT, para que el match sea exitoso.
              </li>
              <li>
                El archivo no se persiste hasta que confirmes la importación en
                el paso de previsualización.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase text-muted-foreground">
          Formatos disponibles
        </h2>

        {templatesError && (
          <Card>
            <CardContent className="pt-6 text-sm">
              <p className="text-destructive">
                No se pudieron cargar las plantillas: {templatesError}
              </p>
              <p className="text-muted-foreground mt-2">
                Puedes igualmente continuar al wizard si conoces el formato de
                tu archivo.
              </p>
            </CardContent>
          </Card>
        )}

        {templates.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4">
            {templates.map((tpl) => (
              <FormatCard key={tpl.format} template={tpl} />
            ))}
          </div>
        ) : !templatesError ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Aún no hay plantillas configuradas. Contacta al equipo de soporte.
            </CardContent>
          </Card>
        ) : null}
      </section>
    </PageContainer>
  );
}
