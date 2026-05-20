import { z } from 'zod';
import { userRoleSchema } from './user.schema';

export const sessionUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  orgId: z.string().uuid(),
  role: userRoleSchema,
});

export type SessionUser = z.infer<typeof sessionUserSchema>;
