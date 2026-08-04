import { z } from 'zod';
import { userRoleSchema } from './user.schema';

/**
 * Roles que un school_admin puede asignar desde el panel /equipo.
 *
 * Excluidos a propósito:
 *  - foundation_director, platform_admin: roles de red de colegios / plataforma,
 *    se crean solo desde super-admin.
 *  - guardian: apoderados se vinculan vía inscripción de alumnos, no por whitelist.
 */
export const ASSIGNABLE_SCHOOL_ROLES = [
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
  'teacher',
  'homeroom_teacher',
] as const;

export const assignableSchoolRoleSchema = z.enum(ASSIGNABLE_SCHOOL_ROLES);
export type AssignableSchoolRole = z.infer<typeof assignableSchoolRoleSchema>;

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email('Correo inválido')
  .max(320);

export const inviteMemberSchema = z.object({
  email: emailField,
  role: assignableSchoolRoleSchema,
});

export const bulkInviteMembersSchema = z.object({
  members: z.array(inviteMemberSchema).min(1).max(500),
});

export const skipReasonSchema = z.enum([
  'duplicate_in_org',
  'cross_org_conflict',
  'invalid_role',
  'invalid_email',
  'last_admin',
]);

export const bulkInviteResponseSchema = z.object({
  created: z.number().int().min(0),
  skipped: z.array(
    z.object({
      email: z.string(),
      role: z.string(),
      reason: skipReasonSchema,
      message: z.string(),
    }),
  ),
});

export const memberStatusSchema = z.enum(['active', 'pending']);

export const memberModelSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: userRoleSchema,
  status: memberStatusSchema,
  isActive: z.boolean(),
  lastLoginAt: z.string().datetime().nullable(),
  invitedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export type InviteMemberDto = z.infer<typeof inviteMemberSchema>;
export type BulkInviteMembersDto = z.infer<typeof bulkInviteMembersSchema>;
export type BulkInviteResponse = z.infer<typeof bulkInviteResponseSchema>;
export type MemberStatus = z.infer<typeof memberStatusSchema>;
export type MemberModel = z.infer<typeof memberModelSchema>;
export type SkipReason = z.infer<typeof skipReasonSchema>;
