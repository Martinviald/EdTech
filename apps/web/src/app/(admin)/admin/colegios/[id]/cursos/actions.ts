'use server';

import { revalidatePath } from 'next/cache';
import { createClassGroupSchema } from '@soe/types';
import { createClassGroup, deleteClassGroup } from '@/lib/adminApi';

type ActionResult = { ok: true } | { ok: false; error: string };

export async function createClassGroupAction(
  orgId: string,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createClassGroupSchema.safeParse({
    gradeId: formData.get('gradeId'),
    name: String(formData.get('name') ?? '').trim(),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
  }
  try {
    await createClassGroup(orgId, parsed.data);
    revalidatePath(`/admin/colegios/${orgId}/cursos`);
    revalidatePath(`/admin/colegios/${orgId}/asignaturas`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}

export async function deleteClassGroupAction(
  orgId: string,
  classGroupId: string,
): Promise<ActionResult> {
  try {
    await deleteClassGroup(orgId, classGroupId);
    revalidatePath(`/admin/colegios/${orgId}/cursos`);
    revalidatePath(`/admin/colegios/${orgId}/asignaturas`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}
