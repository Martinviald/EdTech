import { getSubjectMatrix } from '@/lib/adminApi';
import { SubjectMatrix } from './SubjectMatrix';

export const dynamic = 'force-dynamic';

export default async function AdminOrgAsignaturasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const matrix = await getSubjectMatrix(id);
  return <SubjectMatrix orgId={id} matrix={matrix} />;
}
