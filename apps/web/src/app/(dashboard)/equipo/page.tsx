import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { canAccess, STAFF_MANAGEMENT_ROLES, type MemberModel } from '@soe/types';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import { PageContainer, PageHeader, TableSkeleton } from '@/components/shared';
import { AddMemberDialog } from './AddMemberDialog';
import { BulkImportDialog } from './BulkImportDialog';
import { MembersTable } from './MembersTable';

export default async function EquipoPage() {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, STAFF_MANAGEMENT_ROLES)) redirect(ROUTES.dashboard);

  return (
    <PageContainer>
      <PageHeader
        title="Equipo"
        description="Invita docentes y coordinadores a tu colegio. No enviamos correos: avísale a tu equipo que ya pueden iniciar sesión con su cuenta Google institucional."
        actions={
          <>
            <BulkImportDialog />
            <AddMemberDialog />
          </>
        }
      />

      <Suspense fallback={<TableSkeleton />}>
        <MembersSection currentUserId={session.user.id} />
      </Suspense>
    </PageContainer>
  );
}

async function MembersSection({ currentUserId }: { currentUserId: string }) {
  const members = await apiGet<MemberModel[]>('/organizations/me/members');

  return <MembersTable members={members} currentUserId={currentUserId} />;
}
