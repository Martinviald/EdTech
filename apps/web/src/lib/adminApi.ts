import 'server-only';
import { apiDelete, apiGet, apiPost } from './api';
import type {
  AdminCreateOrganizationDto,
  AdminCreateUserDto,
  GrantMembershipDto,
  GrantPlatformAdminDto,
} from '@soe/types';

export type AdminOrgListItem = {
  id: string;
  name: string;
  rbd: string | null;
  commune: string | null;
  region: string | null;
  dependence: string | null;
  createdAt: string;
};

export type AdminOrgList = {
  items: AdminOrgListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type AdminOrgDetail = AdminOrgListItem & { membershipCount: number };

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

export function listOrgs(query?: { q?: string; limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  if (query?.q) params.set('q', query.q);
  if (query?.limit) params.set('limit', String(query.limit));
  if (query?.offset) params.set('offset', String(query.offset));
  const qs = params.toString();
  return apiGet<AdminOrgList>(`/admin/organizations${qs ? `?${qs}` : ''}`);
}

export function createOrg(dto: AdminCreateOrganizationDto) {
  return apiPost<AdminOrgListItem>('/admin/organizations', dto);
}

export function getOrg(id: string) {
  return apiGet<AdminOrgDetail>(`/admin/organizations/${id}`);
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
