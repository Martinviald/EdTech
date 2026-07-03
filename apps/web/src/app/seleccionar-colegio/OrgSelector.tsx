'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Building2, Loader2 } from 'lucide-react';
import { switchOrgAction } from '@/lib/sessionActions';

/**
 * Lista de colegios a los que el usuario tiene acceso. Al elegir uno:
 *  1. switchOrgAction — el backend revalida el membership y devuelve los
 *     roles/activeRole de esa org (se recalculan por-org).
 *  2. useSession().update({ activeOrg }) — persiste la org activa en el JWT.
 *  3. push('/dashboard') — entra al colegio elegido.
 */
export function OrgSelector({ orgs }: { orgs: readonly { id: string; name: string }[] }) {
  const router = useRouter();
  const { update } = useSession();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(orgId: string) {
    if (pendingId) return;
    setPendingId(orgId);
    setError(null);
    try {
      const result = await switchOrgAction(orgId);
      await update({ activeOrg: result });
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo entrar al colegio');
      setPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {orgs.map((org) => (
        <button
          key={org.id}
          type="button"
          disabled={pendingId !== null}
          onClick={() => handleSelect(org.id)}
          className="flex w-full items-center gap-3 rounded-md border border-border bg-background px-4 py-3 text-left text-sm font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
        >
          <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex-1">{org.name}</span>
          {pendingId === org.id ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          ) : null}
        </button>
      ))}

      {error ? <p className="mt-1 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
