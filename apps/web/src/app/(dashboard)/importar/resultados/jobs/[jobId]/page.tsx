import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertCircle, ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import { ANSWER_SHEET_IMPORT_ROLES, canAccess } from '@soe/types';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageContainer, PageHeader } from '@/components/shared';
import { getImportJobAction } from '../../actions';
import { JobStatusCard } from '../../components/job-status-card';

type PageProps = {
  params: Promise<{ jobId: string }>;
};

export default async function JobStatusPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user?.orgId) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, ANSWER_SHEET_IMPORT_ROLES)) {
    redirect(ROUTES.dashboard);
  }

  const { jobId } = await params;
  const result = await getImportJobAction(jobId);

  return (
    <PageContainer>
      <PageHeader
        title="Estado de la importación"
        description="Detalle del job que procesa las respuestas y calcula los resultados."
      />

      {!result.ok ? (
        <div className="space-y-4">
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex items-start gap-3 pt-6 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="space-y-0.5">
                <p className="font-medium">No se pudo cargar el job</p>
                <p>{result.message}</p>
              </div>
            </CardContent>
          </Card>
          <Button asChild variant="outline">
            <Link href={ROUTES.importarResultados}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver a importar resultados
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <JobStatusCard job={result.data} />

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button asChild variant="outline">
              <Link href={ROUTES.importarResultados}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Volver a importar resultados
              </Link>
            </Button>

            {result.data.assessmentId &&
              (result.data.status === 'completed' || result.data.status === 'partial') && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  {/* Cierre de loop: ir directo a la evaluación recién importada,
                      no al dashboard genérico. */}
                  <Button asChild variant="outline">
                    <Link href={ROUTES.evaluacionAnalisisIa(result.data.assessmentId)}>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generar análisis IA
                    </Link>
                  </Button>
                  <Button asChild>
                    <Link href={ROUTES.evaluacionResultados(result.data.assessmentId)}>
                      Ver resultados de la evaluación
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              )}
          </div>
        </>
      )}
    </PageContainer>
  );
}
