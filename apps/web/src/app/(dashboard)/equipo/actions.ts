'use server';

import { revalidatePath } from 'next/cache';
import { ROUTES } from '@/lib/routes';
import {
  bulkInviteMembersSchema,
  inviteMemberSchema,
  type BulkInviteMembersDto,
  type BulkInviteResponse,
  type InviteMemberDto,
  type MemberModel,
} from '@soe/types';
import { apiDelete, apiPost } from '@/lib/api';

export async function inviteMember(dto: InviteMemberDto): Promise<MemberModel> {
  const validated = inviteMemberSchema.parse(dto);
  const created = await apiPost<MemberModel>('/organizations/me/members', validated);
  revalidatePath(ROUTES.equipo);
  return created;
}

export async function bulkInviteMembers(
  dto: BulkInviteMembersDto,
): Promise<BulkInviteResponse> {
  const validated = bulkInviteMembersSchema.parse(dto);
  const result = await apiPost<BulkInviteResponse>(
    '/organizations/me/members/bulk',
    validated,
  );
  revalidatePath(ROUTES.equipo);
  return result;
}

export async function revokeMember(membershipId: string): Promise<void> {
  await apiDelete(`/organizations/me/members/${membershipId}`);
  revalidatePath(ROUTES.equipo);
}
