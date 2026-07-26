'use client';

import { signOut } from 'next-auth/react';
import { toast } from 'sonner';

import { ROUTES } from '@/lib/routes';

/**
 * Cierra la sesión y vuelve al login. Compartido por el menú de usuario de la
 * topbar y el botón al pie del sidebar — un solo lugar define el aviso y el
 * destino post-logout.
 */
export async function signOutToLogin(): Promise<void> {
  toast.success('Sesión cerrada');
  await signOut({ callbackUrl: ROUTES.login });
}
