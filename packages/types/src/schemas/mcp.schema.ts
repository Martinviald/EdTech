import { z } from 'zod';
import { userRoleSchema } from './user.schema';

export const mcpOrgSummarySchema = z.object({
  orgId: z.string().uuid(),
  name: z.string(),
  roles: z.array(userRoleSchema),
  isActive: z.boolean(),
});

export const mcpListMyOrgsOutputSchema = z.object({
  orgs: z.array(mcpOrgSummarySchema),
});

export const mcpSetActiveOrgInputSchema = z.object({
  orgId: z.string().uuid(),
});

export const mcpSetActiveOrgOutputSchema = z.object({
  orgId: z.string().uuid(),
  orgName: z.string(),
  roles: z.array(userRoleSchema),
  activeRole: userRoleSchema,
});

export type McpOrgSummary = z.infer<typeof mcpOrgSummarySchema>;
export type McpListMyOrgsOutput = z.infer<typeof mcpListMyOrgsOutputSchema>;
export type McpSetActiveOrgInput = z.infer<typeof mcpSetActiveOrgInputSchema>;
export type McpSetActiveOrgOutput = z.infer<typeof mcpSetActiveOrgOutputSchema>;
