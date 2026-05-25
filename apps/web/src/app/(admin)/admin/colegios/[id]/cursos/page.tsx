import { getSubjectMatrix, listGrades } from '@/lib/adminApi';
import { CoursesManager } from './CoursesManager';

export const dynamic = 'force-dynamic';

export default async function AdminOrgCursosPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [matrix, grades] = await Promise.all([getSubjectMatrix(id), listGrades()]);
  return <CoursesManager orgId={id} matrix={matrix} grades={grades} />;
}
