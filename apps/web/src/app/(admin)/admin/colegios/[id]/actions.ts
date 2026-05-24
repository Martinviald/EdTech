'use server';

import { revalidatePath } from 'next/cache';
import { updateOrganizationProfileSchema } from '@soe/types';
import { restoreOrg, softDeleteOrg, updateOrg } from '@/lib/adminApi';

type ActionResult = { ok: true } | { ok: false; error: string };

function emptyToUndefined(v: FormDataEntryValue | null): string | undefined {
  if (v === null) return undefined;
  const s = String(v).trim();
  return s.length === 0 ? undefined : s;
}

export async function updateOrgAction(
  orgId: string,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = updateOrganizationProfileSchema.safeParse({
    name: formData.get('name'),
    rbd: emptyToUndefined(formData.get('rbd')),
    commune: emptyToUndefined(formData.get('commune')),
    region: emptyToUndefined(formData.get('region')),
    dependence: emptyToUndefined(formData.get('dependence')),
    type: emptyToUndefined(formData.get('type')),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
  }

  try {
    await updateOrg(orgId, parsed.data);
    revalidatePath('/admin/colegios');
    revalidatePath(`/admin/colegios/${orgId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}

export async function softDeleteOrgAction(orgId: string): Promise<ActionResult> {
  try {
    await softDeleteOrg(orgId);
    revalidatePath('/admin/colegios');
    revalidatePath(`/admin/colegios/${orgId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}

export async function restoreOrgAction(orgId: string): Promise<ActionResult> {
  try {
    await restoreOrg(orgId);
    revalidatePath('/admin/colegios');
    revalidatePath(`/admin/colegios/${orgId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}
