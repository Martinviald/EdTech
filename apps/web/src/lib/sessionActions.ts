'use server';

import { USER_ROLES, type UserRole } from '@soe/types';
import { apiPost } from './api';

type SwitchRoleResponse = { activeRole: UserRole; roles: UserRole[] };

/**
 * Server action que cambia el `activeRole` del usuario en la BD/sesión.
 *
 * Llama al endpoint `/auth/switch-role` (autenticado vía Bearer del cookie de
 * sesión). El backend valida que el rol elegido esté en los memberships del
 * usuario y devuelve el nuevo `activeRole`. El cliente luego debe llamar a
 * `useSession().update({ activeRole })` para que NextAuth re-emita el JWT con
 * el nuevo valor — el callback `jwt` en `auth.ts` reconoce el `trigger='update'`.
 */
export async function switchRoleAction(role: UserRole): Promise<SwitchRoleResponse> {
  if (!(USER_ROLES as readonly string[]).includes(role)) {
    throw new Error('Rol inválido');
  }
  return apiPost<SwitchRoleResponse>('/auth/switch-role', { role });
}
