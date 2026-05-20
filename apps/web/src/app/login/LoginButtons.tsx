'use client';

import { signIn } from 'next-auth/react';

export function LoginButtons() {
  return (
    <div className="flex w-full flex-col gap-3">
      <button
        type="button"
        onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
        className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition hover:bg-muted"
      >
        Continuar con Google
      </button>
      <button
        type="button"
        onClick={() => signIn('microsoft-entra-id', { callbackUrl: '/dashboard' })}
        className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition hover:bg-muted"
      >
        Continuar con Microsoft
      </button>
    </div>
  );
}
