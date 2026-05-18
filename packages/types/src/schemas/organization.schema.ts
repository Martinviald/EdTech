import { z } from 'zod';
import { ORG_TYPES } from '../enums';

export const orgTypeSchema = z.enum(ORG_TYPES);

export const createOrganizationSchema = z.object({
  type: orgTypeSchema,
  name: z.string().min(2).max(200),
  rbd: z.string().optional(),
  parentId: z.string().uuid().optional(),
  config: z.record(z.unknown()).optional(),
});

export const updateOrganizationSchema = createOrganizationSchema.partial();

export type CreateOrganizationDto = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationDto = z.infer<typeof updateOrganizationSchema>;
