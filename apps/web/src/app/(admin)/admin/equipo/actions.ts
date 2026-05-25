'use server';

import { revalidatePath } from 'next/cache';
import { grantPlatformAdminSchema } from '@soe/types';
import {
  grantPlatformAdmin,
  revokePlatformAdmin,
  searchUsers,
} from '@/lib/adminApi';

type ActionResult = { ok: true } | { ok: false; error: string };

export async function grantPlatformAdminAction(formData: FormData): Promise<ActionResult> {
  const parsed = grantPlatformAdminSchema.safeParse({
    userId: formData.get('userId'),
    notes: formData.get('notes') || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
  }

  try {
    await grantPlatformAdmin(parsed.data);
    revalidatePath('/admin/equipo');
    revalidatePath('/admin');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}

export async function revokePlatformAdminAction(userId: string): Promise<ActionResult> {
  try {
    await revokePlatformAdmin(userId);
    revalidatePath('/admin/equipo');
    revalidatePath('/admin');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}

export async function searchUsersAction(q: string) {
  if (q.trim().length < 2) return [];
  try {
    return await searchUsers(q);
  } catch {
    return [];
  }
}
