'use server';

import { revalidatePath } from 'next/cache';
import { ROUTES } from '@/lib/routes';
import {
  adminCreateOrganizationSchema,
  adminCreateUserSchema,
  grantMembershipSchema,
  userRoleSchema,
} from '@soe/types';
import {
  createOrg,
  createUser,
  grantMembership as grantMembershipApi,
  revokeMembership as revokeMembershipApi,
  searchUsers,
  type AdminCreatedUser,
} from '@/lib/adminApi';

type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export async function createOrganizationAction(formData: FormData): Promise<ActionResult> {
  const parsed = adminCreateOrganizationSchema.safeParse({
    name: formData.get('name'),
    rbd: formData.get('rbd'),
    commune: formData.get('commune') || undefined,
    region: formData.get('region') || undefined,
    dependence: formData.get('dependence') || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
  }

  try {
    await createOrg(parsed.data);
    revalidatePath(ROUTES.adminColegios);
    revalidatePath(ROUTES.admin);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}

export async function grantMembershipAction(
  orgId: string,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = grantMembershipSchema.safeParse({
    userId: formData.get('userId'),
    role: formData.get('role'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
  }

  try {
    await grantMembershipApi(orgId, parsed.data);
    revalidatePath(`/admin/colegios/${orgId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}

export async function revokeMembershipAction(
  orgId: string,
  userId: string,
  role: string,
): Promise<ActionResult> {
  try {
    await revokeMembershipApi(orgId, userId, role);
    revalidatePath(`/admin/colegios/${orgId}`);
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

/**
 * Crea un usuario nuevo y de inmediato lo asocia como miembro del colegio
 * con el rol indicado. Pensado para el atajo "+ Crear nuevo usuario" del
 * diálogo de membresías cuando la búsqueda no encuentra a alguien.
 */
export async function createAndGrantMembershipAction(
  orgId: string,
  formData: FormData,
): Promise<{ ok: true; user: AdminCreatedUser } | { ok: false; error: string }> {
  const userParsed = adminCreateUserSchema.safeParse({
    email: formData.get('email'),
    name: formData.get('name'),
    provider: 'google',
  });
  if (!userParsed.success) {
    return { ok: false, error: userParsed.error.issues[0]?.message ?? 'Datos inválidos' };
  }

  const role = userRoleSchema.safeParse(formData.get('role'));
  if (!role.success) {
    return { ok: false, error: 'Rol inválido' };
  }

  let user: AdminCreatedUser;
  try {
    user = await createUser(userParsed.data);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error al crear usuario' };
  }

  try {
    await grantMembershipApi(orgId, { userId: user.id, role: role.data });
  } catch (err) {
    // Si el grant falla, el user ya existe en DB — no eliminamos para no perder data.
    // Reportamos el error parcial para que el operador pueda re-intentar.
    return {
      ok: false,
      error: `Usuario creado pero falló la asignación: ${err instanceof Error ? err.message : 'desconocido'}`,
    };
  }

  revalidatePath(`/admin/colegios/${orgId}`);
  return { ok: true, user };
}
