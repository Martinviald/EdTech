import 'server-only';
import { apiDelete, apiGet, apiPost } from './api';
import type {
  ClassGroupDetailResponse,
  CreateTeacherAssignmentDto,
  TeacherAssignmentSummary,
} from '@soe/types';

export type OrgTeacher = {
  /** userId, salvo en los pendientes sin usuario: ahí viene como `pending:<membershipId>`. */
  id: string;
  name: string;
  email: string;
  role: string;
  /** 'pending' = invitado que todavía no inició sesión. */
  status: 'active' | 'pending';
  /**
   * Si es `false`, es una invitación vieja sin fila en `users` y NO puede recibir carga
   * (`teacher_assignments.user_id` es NOT NULL). Se lista igual para que no desaparezca
   * del selector sin explicación; se completa volviéndolo a invitar con su nombre.
   */
  assignable: boolean;
};

export type OrgSubjectClass = {
  id: string;
  academicYear: number;
  classGroup: {
    id: string;
    name: string;
    gradeShortName: string;
    gradeOrder: number;
  };
  subject: {
    id: string;
    name: string;
    shortName: string;
  };
};

export type ClassGroupForUser = {
  classGroupId: string;
  className: string;
  gradeShortName: string;
  gradeOrder: number;
  academicYear: number;
  subjectClassId: string | null;
  subjectId: string | null;
  subjectName: string | null;
  subjectShortName: string | null;
  assignmentRole: string | null;
};

export function listAssignments(orgId: string) {
  return apiGet<TeacherAssignmentSummary[]>(`/organizations/${orgId}/teacher-assignments`);
}

export function createAssignment(orgId: string, dto: CreateTeacherAssignmentDto) {
  return apiPost<TeacherAssignmentSummary>(`/organizations/${orgId}/teacher-assignments`, dto);
}

export function deleteAssignment(orgId: string, assignmentId: string) {
  return apiDelete(`/organizations/${orgId}/teacher-assignments/${assignmentId}`);
}

export function listOrgTeachers(orgId: string) {
  return apiGet<OrgTeacher[]>(`/organizations/${orgId}/teachers`);
}

export function listSubjectClasses(orgId: string) {
  return apiGet<OrgSubjectClass[]>(`/organizations/${orgId}/subject-classes`);
}

export function listClassGroupsForUser(orgId: string) {
  return apiGet<ClassGroupForUser[]>(`/organizations/${orgId}/class-groups`);
}

export function getClassGroupDetail(orgId: string, classGroupId: string) {
  return apiGet<ClassGroupDetailResponse>(`/organizations/${orgId}/class-groups/${classGroupId}`);
}
