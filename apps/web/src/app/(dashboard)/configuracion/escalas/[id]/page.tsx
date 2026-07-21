import { Suspense } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  GRADING_SCALE_ROLES,
  userHasRole,
  type GradingScaleResponseModel,
  type UserRole,
} from '@soe/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer, PageHeader, CardSkeleton } from '@/components/shared';
import { EscalaForm } from '../components/escala-form';
import { ConversionPreview } from '../components/conversion-preview';
import { DeleteButton } from '../components/delete-button';
import { SCALE_TYPE_LABELS } from '../components/scale-format';

export default async function EscalaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.orgId) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, GRADING_SCALE_ROLES)) {
    redirect(ROUTES.dashboard);
  }

  const { id } = await params;

  return (
    <PageContainer>
      <Suspense fallback={<EscalaDetailSkeleton />}>
        <EscalaDetailSection
          id={id}
          orgId={session.user.orgId}
          roles={session.user.roles}
        />
      </Suspense>
    </PageContainer>
  );
}

function EscalaDetailSkeleton() {
  return (
    <>
      <Skeleton className="h-4 w-40" />
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <CardSkeleton rows={5} />
        <CardSkeleton rows={5} />
      </div>
      <CardSkeleton rows={2} />
    </>
  );
}

async function EscalaDetailSection({
  id,
  orgId,
  roles,
}: {
  id: string;
  orgId: string;
  roles: readonly UserRole[];
}) {
  let scale: GradingScaleResponseModel;
  try {
    scale = await apiGet<GradingScaleResponseModel>(`/grading-scales/${id}`);
  } catch {
    notFound();
  }

  const isPlatformAdmin = userHasRole(roles, 'platform_admin');
  // Las escalas globales (orgId null) solo pueden editarlas platform_admin.
  // Las de la org solo pueden editarlas usuarios de esa org (el filtro real
  // ya lo hace el backend; acá decidimos solo el shape de la UI).
  const editable = scale.isGlobal
    ? isPlatformAdmin
    : scale.orgId === orgId || isPlatformAdmin;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link
            href={ROUTES.configEscalas}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
          >
            <ChevronLeft className="size-4" /> Volver a escalas
          </Link>
        }
        title={scale.name}
        badges={
          scale.isGlobal ? (
            <Badge variant="secondary">Global</Badge>
          ) : (
            <Badge variant="outline">Mi colegio</Badge>
          )
        }
        description={SCALE_TYPE_LABELS[scale.type] ?? scale.type}
      />
      {!editable ? (
        <p className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-xs">
          Esta escala es de solo lectura para tu cuenta. Las escalas globales solo pueden
          editarlas administradores de plataforma.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Configuración</CardTitle>
          </CardHeader>
          <CardContent>
            {editable ? (
              <EscalaForm mode="edit" initial={scale} canManageGlobal={isPlatformAdmin} />
            ) : (
              <ReadonlySummary scale={scale} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Previsualización</CardTitle>
          </CardHeader>
          <CardContent>
            <ConversionPreview scaleId={scale.id} />
          </CardContent>
        </Card>
      </div>

      {editable ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Zona de peligro</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4 text-sm">
              Eliminar la escala es definitivo. Si algún instrumento todavía la usa, el sistema
              bloqueará la operación.
            </p>
            <DeleteButton scaleId={scale.id} scaleName={scale.name} />
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

function ReadonlySummary({ scale }: { scale: GradingScaleResponseModel }) {
  const min = Number(scale.minGrade).toFixed(1);
  const max = Number(scale.maxGrade).toFixed(1);
  const passing = Number(scale.passingGrade).toFixed(1);
  const thresholdPct = Math.round(Number(scale.passingThreshold) * 100);

  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <div>
        <dt className="text-muted-foreground">Rango</dt>
        <dd className="font-medium">
          {min} — {max}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Nota mínima de aprobación</dt>
        <dd className="font-medium">{passing}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Umbral de aprobación</dt>
        <dd className="font-medium">{thresholdPct}%</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Tipo</dt>
        <dd className="font-medium">{SCALE_TYPE_LABELS[scale.type] ?? scale.type}</dd>
      </div>
    </dl>
  );
}
