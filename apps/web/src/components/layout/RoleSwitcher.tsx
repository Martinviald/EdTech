'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Check, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import type { UserRole } from '@soe/types';
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { switchRoleAction } from '@/lib/sessionActions';
import { ROLE_LABELS } from './nav-items';

interface RoleSwitcherProps {
  roles: readonly UserRole[];
  activeRole: UserRole;
}

/**
 * Sub-menú dentro de UserNav que permite alternar entre los roles activos
 * del usuario en su org. Si sólo tiene un rol, no se renderiza nada
 * (el padre puede colapsar el separator también).
 *
 * Flujo:
 *  1. Server action POST /auth/switch-role — valida y persiste server-side.
 *  2. useSession().update({ activeRole }) — gatilla el callback jwt con
 *     trigger='update' para que el JWT incorpore el nuevo activeRole.
 *  3. router.refresh() — re-fetcha layouts/Server Components para que la
 *     UI refleje el cambio (sidebar items, badges, etc.).
 */
export function RoleSwitcher({ roles, activeRole }: RoleSwitcherProps) {
  const router = useRouter();
  const { update } = useSession();
  const [isPending, startTransition] = useTransition();

  if (roles.length <= 1) return null;

  function handleSelect(role: UserRole) {
    if (role === activeRole || isPending) return;
    startTransition(async () => {
      try {
        const result = await switchRoleAction(role);
        await update({ activeRole: result.activeRole });
        router.refresh();
        toast.success(`Rol activo: ${ROLE_LABELS[result.activeRole] ?? result.activeRole}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'No se pudo cambiar el rol';
        toast.error(msg);
      }
    });
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <UserCog className="size-4" aria-hidden />
        Cambiar rol
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64">
        <DropdownMenuRadioGroup
          value={activeRole}
          onValueChange={(v) => handleSelect(v as UserRole)}
        >
          {roles.map((role) => (
            <DropdownMenuRadioItem key={role} value={role} disabled={isPending}>
              <span className="flex-1">{ROLE_LABELS[role] ?? role}</span>
              {role === activeRole ? (
                <Check className="ml-2 size-4 text-muted-foreground" aria-hidden />
              ) : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
