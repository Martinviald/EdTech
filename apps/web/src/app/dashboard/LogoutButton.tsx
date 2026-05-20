'use client';

import { signOut } from 'next-auth/react';

export function LogoutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: '/login' })}
      className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
    >
      Cerrar sesión
    </button>
  );
}
