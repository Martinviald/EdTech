import 'server-only';
import { apiDelete, apiGet, apiPatch, apiPost } from './api';
import type {
  AdminCreateOrganizationDto,
  AdminCreateUserDto,
  GrantMembershipDto,
  GrantPlatformAdminDto,
  UpdateOrganizationProfileDto,
} from '@soe/types';

export type AdminOrgListItem = {
  id: string;
  name: string;
  rbd: string | null;
  commune: string | null;
  region: string | null;
  dependence: string | null;
  createdAt: string;
  deletedAt: string | null;
};

export type AdminOrgList = {
  items: AdminOrgListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type AdminOrgDetail = AdminOrgListItem & {
  type: 'platform' | 'foundation' | 'school';
  membershipCount: number;
};

export type AdminMembership = {
  membership: {
    id: string;
    userId: string;
    orgId: string;
    role: string;
    isActive: boolean;
    createdAt: string;
  };
  user: { id: string; email: string; name: string };
};

export type PlatformAdminEntry = {
  id: string;
  userId: string;
  grantedAt: string;
  notes: string | null;
  user: { id: string; email: string; name: string };
};

export type UserSearchResult = { id: string; email: string; name: string };

export function listOrgs(query?: {
  q?: string;
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}) {
  const params = new URLSearchParams();
  if (query?.q) params.set('q', query.q);
  if (query?.limit) params.set('limit', String(query.limit));
  if (query?.offset) params.set('offset', String(query.offset));
  if (query?.includeDeleted) params.set('includeDeleted', 'true');
  const qs = params.toString();
  return apiGet<AdminOrgList>(`/admin/organizations${qs ? `?${qs}` : ''}`);
}

export function createOrg(dto: AdminCreateOrganizationDto) {
  return apiPost<AdminOrgListItem>('/admin/organizations', dto);
}

export function getOrg(id: string) {
  return apiGet<AdminOrgDetail>(`/admin/organizations/${id}`);
}

/**
 * Actualiza el perfil de un colegio. Reutiliza PATCH /organizations/:id
 * (no /admin/...), que ya soporta platform_admin vía getEffectiveOrgId.
 */
export function updateOrg(id: string, dto: UpdateOrganizationProfileDto) {
  return apiPatch<AdminOrgDetail>(`/organizations/${id}`, dto);
}

export function softDeleteOrg(id: string) {
  return apiDelete<{ ok: true; alreadyDeleted: boolean }>(`/organizations/${id}`);
}

export function restoreOrg(id: string) {
  return apiPost<{ ok: true; alreadyActive: boolean }>(`/organizations/${id}/restore`, {});
}

// ── Asignaturas y cursos ─────────────────────────────────────────────

export type SubjectMatrix = {
  academicYear: { id: string; year: number } | null;
  classGroups: Array<{
    id: string;
    name: string;
    gradeShortName: string;
    gradeName: string;
    gradeOrder: number;
  }>;
  allSubjects: Array<{ id: string; name: string; shortName: string; code: string }>;
  cells: Array<{ classGroupId: string; subjectId: string; subjectClassId: string }>;
};

export function getSubjectMatrix(orgId: string) {
  return apiGet<SubjectMatrix>(`/organizations/${orgId}/subject-matrix`);
}

export function bulkAddSubjectsToYear(orgId: string, subjectIds: string[]) {
  return apiPost<{ created: number; alreadyExisting: number; total: number }>(
    `/organizations/${orgId}/subject-classes/bulk`,
    { subjectIds },
  );
}

export function addSubjectToClassGroup(orgId: string, classGroupId: string, subjectId: string) {
  return apiPost<{ id: string }>(
    `/organizations/${orgId}/class-groups/${classGroupId}/subjects`,
    { subjectId },
  );
}

export function removeSubjectClass(orgId: string, subjectClassId: string) {
  return apiDelete<{ ok: true }>(`/organizations/${orgId}/subject-classes/${subjectClassId}`);
}

export type AdminGrade = {
  id: string;
  name: string;
  shortName: string;
  code: string;
  cycle: number;
  order: number;
};

export function listGrades() {
  return apiGet<AdminGrade[]>('/organizations/grades');
}

export function createClassGroup(orgId: string, dto: { gradeId: string; name: string }) {
  return apiPost<{ id: string }>(`/organizations/${orgId}/class-groups`, dto);
}

export function deleteClassGroup(orgId: string, classGroupId: string) {
  return apiDelete<{ ok: true }>(`/organizations/${orgId}/class-groups/${classGroupId}`);
}

export function listMemberships(orgId: string) {
  return apiGet<AdminMembership[]>(`/admin/organizations/${orgId}/memberships`);
}

export function grantMembership(orgId: string, dto: GrantMembershipDto) {
  return apiPost<{ ok: true }>(`/admin/organizations/${orgId}/memberships`, dto);
}

export function revokeMembership(orgId: string, userId: string, role: string) {
  return apiDelete<{ ok: true }>(
    `/admin/organizations/${orgId}/memberships/${userId}/${role}`,
  );
}

export function searchUsers(q: string) {
  return apiGet<UserSearchResult[]>(`/admin/users?q=${encodeURIComponent(q)}`);
}

export type AdminCreatedUser = {
  id: string;
  email: string;
  name: string;
  provider: string;
  providerId: string;
};

export function createUser(dto: AdminCreateUserDto) {
  return apiPost<AdminCreatedUser>('/admin/users', dto);
}

export function listPlatformAdmins() {
  return apiGet<PlatformAdminEntry[]>('/admin/platform-admins');
}

export function grantPlatformAdmin(dto: GrantPlatformAdminDto) {
  return apiPost<{ ok: true }>('/admin/platform-admins', dto);
}

export function revokePlatformAdmin(userId: string) {
  return apiDelete<{ ok: true }>(`/admin/platform-admins/${userId}`);
}
