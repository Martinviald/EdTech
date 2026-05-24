import { redirect } from 'next/navigation';
import type { MemberModel } from '@soe/types';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { AddMemberDialog } from './AddMemberDialog';
import { BulkImportDialog } from './BulkImportDialog';
import { MembersTable } from './MembersTable';

const ALLOWED_ROLES = ['school_admin', 'platform_admin'];

export default async function EquipoPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!ALLOWED_ROLES.includes(session.user.role)) redirect('/dashboard');

  const members = await apiGet<MemberModel[]>('/organizations/me/members');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Equipo</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Invita docentes y coordinadores a tu colegio. No enviamos correos: avísale a tu equipo
            que ya pueden iniciar sesión con su cuenta Google institucional.
          </p>
        </div>
        <div className="flex gap-2">
          <BulkImportDialog />
          <AddMemberDialog />
        </div>
      </div>

      <MembersTable members={members} currentUserId={session.user.id} />
    </div>
  );
}
