import 'server-only';
import { apiDelete, apiGet, apiPost } from './api';
import type { CreateTeacherAssignmentDto, TeacherAssignmentSummary } from '@soe/types';

export type OrgTeacher = {
  id: string;
  name: string;
  email: string;
  role: string;
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
