import { listMemberships } from '@/lib/adminApi';
import { MembershipsTable } from '../MembershipsTable';

export const dynamic = 'force-dynamic';

export default async function AdminOrgMembershipsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const memberships = await listMemberships(id);

  return <MembershipsTable orgId={id} rows={memberships} />;
}
