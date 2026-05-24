import { redirect } from 'next/navigation';
import { ASSIGNMENTS_ROLES, canAccess } from '@soe/types';
import { auth } from '@/auth';
import {
  listAssignments,
  listOrgTeachers,
  listSubjectClasses,
} from '@/lib/teacherAssignmentsApi';
import { AssignmentsTable } from './AssignmentsTable';
import { CreateAssignmentDialog } from './CreateAssignmentDialog';

export default async function AsignacionesPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect('/login');
  if (!canAccess(session.user.roles, ASSIGNMENTS_ROLES)) redirect('/organizacion');

  const orgId = session.user.orgId;

  const [assignments, teachers, subjectClasses] = await Promise.all([
    listAssignments(orgId),
    listOrgTeachers(orgId),
    listSubjectClasses(orgId),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Carga académica</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Asigna profesores a las asignaturas de cada curso. Los profesores solo verán los
            cursos donde tengan una asignación activa.
          </p>
        </div>
        <CreateAssignmentDialog
          orgId={orgId}
          teachers={teachers}
          subjectClasses={subjectClasses}
        />
      </div>

      <AssignmentsTable orgId={orgId} rows={assignments} />
    </div>
  );
}
