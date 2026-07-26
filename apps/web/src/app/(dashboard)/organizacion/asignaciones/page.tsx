import { redirect } from 'next/navigation';
import { ASSIGNMENTS_ROLES, canAccess } from '@soe/types';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { PageContainer } from '@/components/shared';
import {
  listAssignments,
  listOrgTeachers,
  listSubjectClasses,
} from '@/lib/teacherAssignmentsApi';
import { OrgHubHeader } from '../components/OrgHubHeader';
import { AssignmentsTable } from './AssignmentsTable';
import { CreateAssignmentDialog } from './CreateAssignmentDialog';

export default async function AsignacionesPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, ASSIGNMENTS_ROLES)) redirect(ROUTES.organizacion);

  const orgId = session.user.orgId;

  const [assignments, teachers, subjectClasses] = await Promise.all([
    listAssignments(orgId),
    listOrgTeachers(orgId),
    listSubjectClasses(orgId),
  ]);

  return (
    <PageContainer>
      <OrgHubHeader />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Asigna profesores a las asignaturas de cada curso. Los profesores solo verán los
          cursos donde tengan una asignación activa.
        </p>
        <CreateAssignmentDialog
          orgId={orgId}
          teachers={teachers}
          subjectClasses={subjectClasses}
        />
      </div>

      <AssignmentsTable orgId={orgId} rows={assignments} />
    </PageContainer>
  );
}
