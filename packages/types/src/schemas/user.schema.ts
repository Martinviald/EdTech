import { z } from 'zod';
import { USER_ROLES } from '../enums';

export const userRoleSchema = z.enum(USER_ROLES);

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(200),
  avatarUrl: z.string().url().optional(),
  provider: z.enum(['google', 'microsoft']),
  providerId: z.string(),
});

export const createMembershipSchema = z.object({
  userId: z.string().uuid(),
  orgId: z.string().uuid(),
  role: userRoleSchema,
  scope: z
    .object({
      gradeIds: z.array(z.string().uuid()).optional(),
      subjectIds: z.array(z.string().uuid()).optional(),
      classGroupIds: z.array(z.string().uuid()).optional(),
    })
    .optional(),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;
export type CreateMembershipDto = z.infer<typeof createMembershipSchema>;
