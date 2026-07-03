'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Building2, Check } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { switchOrgAction } from '@/lib/sessionActions';

interface OrgSwitcherProps {
  orgs: readonly { id: string; name: string }[];
  activeOrgId: string | null;
}

/**
 * Sub-menú dentro de UserNav que permite alternar entre las organizaciones
 * (colegios) a las que pertenece el usuario. Si sólo tiene una, no renderiza nada.
 *
 * Flujo (espeja RoleSwitcher, pero cambiar de org recalcula los roles):
 *  1. Server action POST /auth/switch-org — revalida el membership contra la BD
 *     y devuelve los roles/activeRole de la org destino.
 *  2. useSession().update({ activeOrg }) — gatilla el callback jwt con
 *     trigger='update' para que el JWT incorpore la nueva org + sus roles.
 *  3. router.refresh() — re-fetcha layouts/Server Components para reflejar el
 *     cambio (sidebar, badges, datos de la org).
 */
export function OrgSwitcher({ orgs, activeOrgId }: OrgSwitcherProps) {
  const router = useRouter();
  const { update } = useSession();
  const [isPending, startTransition] = useTransition();

  if (orgs.length <= 1) return null;

  function handleSelect(orgId: string) {
    if (orgId === activeOrgId || isPending) return;
    startTransition(async () => {
      try {
        const result = await switchOrgAction(orgId);
        await update({ activeOrg: result });
        router.refresh();
        toast.success(`Colegio activo: ${result.orgName}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'No se pudo cambiar de colegio';
        toast.error(msg);
      }
    });
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Building2 className="size-4" aria-hidden />
        Cambiar colegio
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64">
        <DropdownMenuRadioGroup
          value={activeOrgId ?? undefined}
          onValueChange={(v) => handleSelect(v)}
        >
          {orgs.map((org) => (
            <DropdownMenuRadioItem key={org.id} value={org.id} disabled={isPending}>
              <span className="flex-1">{org.name}</span>
              {org.id === activeOrgId ? (
                <Check className="ml-2 size-4 text-muted-foreground" aria-hidden />
              ) : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
