import { z } from 'zod';
import { userRoleSchema } from './user.schema';

export const sessionUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  orgId: z.string().uuid(),
  roles: z.array(userRoleSchema).min(1),
  activeRole: userRoleSchema,
  /** @deprecated mirror de activeRole durante la migración multi-rol. */
  role: userRoleSchema,
});

export type SessionUser = z.infer<typeof sessionUserSchema>;

export const switchRoleSchema = z.object({
  role: userRoleSchema,
});

export type SwitchRoleDto = z.infer<typeof switchRoleSchema>;
