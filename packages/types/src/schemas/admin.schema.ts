import { z } from 'zod';
import { userRoleSchema } from './user.schema';
import { schoolDependenceSchema } from './organization.schema';

/**
 * DTO para crear un colegio desde el panel de plataforma.
 * Más estricto que createOrganizationSchema general: solo tipo 'school',
 * RBD obligatorio. Los detalles del año académico se completan después
 * por el school_admin desde /organizacion/configurar.
 */
export const adminCreateOrganizationSchema = z.object({
  name: z.string().min(2).max(200),
  rbd: z.string().regex(/^\d{1,5}-[0-9kK]$/, 'Formato RBD inválido (ej: 12345-6)'),
  commune: z.string().min(2).max(100).optional(),
  region: z.string().min(2).max(100).optional(),
  dependence: schoolDependenceSchema.optional(),
});

export const grantMembershipSchema = z.object({
  userId: z.string().uuid(),
  role: userRoleSchema,
});

export const grantPlatformAdminSchema = z.object({
  userId: z.string().uuid(),
  notes: z.string().max(500).optional(),
});

export const adminCreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(200),
  provider: z.enum(['google', 'microsoft']).default('google'),
});

export const searchUsersQuerySchema = z.object({
  q: z.string().min(2).max(100),
});

export const listOrganizationsQuerySchema = z.object({
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type AdminCreateOrganizationDto = z.infer<typeof adminCreateOrganizationSchema>;
export type GrantMembershipDto = z.infer<typeof grantMembershipSchema>;
export type GrantPlatformAdminDto = z.infer<typeof grantPlatformAdminSchema>;
export type AdminCreateUserDto = z.infer<typeof adminCreateUserSchema>;
export type SearchUsersQueryDto = z.infer<typeof searchUsersQuerySchema>;
export type ListOrganizationsQueryDto = z.infer<typeof listOrganizationsQuerySchema>;
