import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { canAccess, GRADING_SCALE_ROLES, type GradingScaleListResponse } from '@soe/types';
import { PageContainer, TableSkeleton } from '@/components/shared';
import { ConfigHubHeader } from '../components/ConfigHubHeader';
import { EscalasTable } from './components/escalas-table';

export default async function EscalasPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, GRADING_SCALE_ROLES)) {
    redirect(ROUTES.dashboard);
  }

  return (
    <PageContainer>
      <ConfigHubHeader
        description="Configura cómo se convierten los porcentajes de logro en notas. Las escalas globales son compartidas por todos los colegios; las propias de tu organización solo aplican a tus evaluaciones."
        actions={
          <Button asChild>
            <Link href={ROUTES.configEscalasNueva}>
              <Plus className="mr-2 size-4" />
              Nueva escala
            </Link>
          </Button>
        }
      />

      <Suspense fallback={<TableSkeleton />}>
        <EscalasSection />
      </Suspense>
    </PageContainer>
  );
}

async function EscalasSection() {
  const scales = await apiGet<GradingScaleListResponse>('/grading-scales?limit=50');
  // El backend devuelve { data, total, page, limit }; si por alguna razón llega
  // un payload sin `data`, no reventamos la vista — mostramos el estado vacío.
  const scaleList = scales?.data ?? [];

  return <EscalasTable scales={scaleList} />;
}
