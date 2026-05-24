'use server';

import { revalidatePath } from 'next/cache';
import { createTeacherAssignmentSchema } from '@soe/types';
import {
  createAssignment,
  deleteAssignment,
} from '@/lib/teacherAssignmentsApi';

type PrimaryConflict = {
  ok: false;
  code: 'PRIMARY_EXISTS';
  error: string;
  currentPrimary: { id: string; name: string };
};

type ActionResult =
  | { ok: true }
  | { ok: false; error: string }
  | PrimaryConflict;

export async function createAssignmentAction(
  orgId: string,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createTeacherAssignmentSchema.safeParse({
    userId: formData.get('userId'),
    subjectClassId: formData.get('subjectClassId'),
    role: formData.get('role') ?? 'primary',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
  }

  try {
    await createAssignment(orgId, parsed.data);
    revalidatePath('/organizacion/asignaciones');
    return { ok: true };
  } catch (err) {
    if (err instanceof Error) {
      // El API serializa el body del ConflictException en err.message; intentamos
      // parsearlo para detectar PRIMARY_EXISTS y devolver datos estructurados.
      try {
        const body = JSON.parse(err.message);
        if (body?.code === 'PRIMARY_EXISTS' && body?.currentPrimary) {
          return {
            ok: false,
            code: 'PRIMARY_EXISTS',
            error: body.message ?? 'Ya existe un profesor titular',
            currentPrimary: body.currentPrimary,
          };
        }
      } catch {
        // mensaje no era JSON — caer al manejo genérico
      }
      // Heurística por mensaje (el wrapper apiPost a veces solo conserva message).
      if (err.message.includes('PRIMARY_EXISTS') || err.message.includes('titular')) {
        return {
          ok: false,
          code: 'PRIMARY_EXISTS',
          error: err.message,
          currentPrimary: { id: '', name: 'profesor titular existente' },
        };
      }
      return { ok: false, error: err.message };
    }
    return { ok: false, error: 'Error desconocido' };
  }
}

export async function deleteAssignmentAction(
  orgId: string,
  assignmentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await deleteAssignment(orgId, assignmentId);
    revalidatePath('/organizacion/asignaciones');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}
