import { z } from 'zod';
import { ORG_TYPES, SCHOOL_DEPENDENCES } from '../enums';

export const orgTypeSchema = z.enum(ORG_TYPES);
export const schoolDependenceSchema = z.enum(SCHOOL_DEPENDENCES);

export const createOrganizationSchema = z.object({
  type: orgTypeSchema,
  name: z.string().min(2).max(200),
  rbd: z.string().optional(),
  parentId: z.string().uuid().optional(),
  config: z.record(z.unknown()).optional(),
});

export const editableOrgTypeSchema = z.enum(['school', 'foundation']);
export type EditableOrgType = z.infer<typeof editableOrgTypeSchema>;

export const updateOrganizationProfileSchema = z.object({
  name: z.string().min(2).max(200),
  rbd: z.string().regex(/^\d{5}-\d$/, 'Formato RBD inválido (ej: 12345-6)').optional(),
  commune: z.string().min(2).max(100).optional(),
  region: z.string().min(2).max(100).optional(),
  dependence: schoolDependenceSchema.optional(),
  type: editableOrgTypeSchema.optional(),
});

export const classGroupInputSchema = z.object({
  gradeId: z.string().uuid(),
  sections: z
    .array(z.string().min(1).max(20))
    .min(1, 'Debe haber al menos una sección por nivel'),
});

export const academicSetupSchema = z.object({
  year: z.number().int().min(2020).max(2040),
  classGroups: z.array(classGroupInputSchema).min(1, 'Debe configurar al menos un nivel'),
  subjectIds: z.array(z.string().uuid()).min(1, 'Debe seleccionar al menos una asignatura'),
});

export const bulkAddSubjectsSchema = z.object({
  subjectIds: z.array(z.string().uuid()).min(1, 'Seleccioná al menos una asignatura'),
});

export const addSubjectToClassGroupSchema = z.object({
  subjectId: z.string().uuid(),
});

export const createClassGroupSchema = z.object({
  gradeId: z.string().uuid(),
  name: z.string().min(1, 'La sección no puede estar vacía').max(20),
});

export const updateOrganizationSchema = createOrganizationSchema.partial();

export type CreateOrganizationDto = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationDto = z.infer<typeof updateOrganizationSchema>;
export type UpdateOrganizationProfileDto = z.infer<typeof updateOrganizationProfileSchema>;
export type ClassGroupInputDto = z.infer<typeof classGroupInputSchema>;
export type AcademicSetupDto = z.infer<typeof academicSetupSchema>;
export type BulkAddSubjectsDto = z.infer<typeof bulkAddSubjectsSchema>;
export type AddSubjectToClassGroupDto = z.infer<typeof addSubjectToClassGroupSchema>;
export type CreateClassGroupDto = z.infer<typeof createClassGroupSchema>;
