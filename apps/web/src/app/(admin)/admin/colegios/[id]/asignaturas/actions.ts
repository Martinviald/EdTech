'use server';

import { revalidatePath } from 'next/cache';
import {
  addSubjectToClassGroup,
  bulkAddSubjectsToYear,
  removeSubjectClass,
} from '@/lib/adminApi';

type ActionResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };

export async function toggleSubjectAction(
  orgId: string,
  classGroupId: string,
  subjectId: string,
  current: 'present' | 'absent',
  subjectClassId: string | null,
): Promise<ActionResult> {
  try {
    if (current === 'absent') {
      await addSubjectToClassGroup(orgId, classGroupId, subjectId);
    } else {
      if (!subjectClassId) {
        return { ok: false, error: 'subjectClassId requerido para quitar' };
      }
      await removeSubjectClass(orgId, subjectClassId);
    }
    revalidatePath(`/admin/colegios/${orgId}/asignaturas`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}

export async function bulkAddSubjectsAction(
  orgId: string,
  subjectIds: string[],
): Promise<ActionResult<{ created: number; alreadyExisting: number; total: number }>> {
  if (subjectIds.length === 0) {
    return { ok: false, error: 'Seleccioná al menos una asignatura' };
  }
  try {
    const data = await bulkAddSubjectsToYear(orgId, subjectIds);
    revalidatePath(`/admin/colegios/${orgId}/asignaturas`);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}
