'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { MoreHorizontal, Trash2, Users } from 'lucide-react';
import type { MemberModel } from '@soe/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState, StatusBadge } from '@/components/shared';
import { revokeMember } from './actions';

const ROLE_LABELS: Record<string, string> = {
  platform_admin: 'Admin plataforma',
  foundation_director: 'Director(a) fundación',
  school_admin: 'Admin del colegio',
  academic_director: 'Director(a) académico(a)',
  cycle_director: 'Director(a) de ciclo',
  dept_head: 'Jefe(a) de depto',
  coordinator: 'Coordinador(a)',
  teacher: 'Docente',
  homeroom_teacher: 'Profesor(a) jefe',
  eval_coordinator: 'Coord. evaluación',
  guardian: 'Apoderado(a)',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function MembersTable({
  members,
  currentUserId,
}: {
  members: MemberModel[];
  currentUserId: string;
}) {
  const [toRevoke, setToRevoke] = useState<MemberModel | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Cantidad de school_admin activos (para deshabilitar revocar si es el último)
  const activeAdminCount = members.filter(
    (m) => m.role === 'school_admin' && m.status === 'active',
  ).length;

  function handleConfirmRevoke() {
    if (!toRevoke) return;
    const member = toRevoke;
    startTransition(async () => {
      try {
        await revokeMember(member.id);
        toast.success(`Se revocó el acceso de ${member.email}`);
        setToRevoke(null);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al revocar');
      }
    });
  }

  if (members.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Aún no hay miembros"
        description="Invita al primer docente o coordinador para comenzar."
      />
    );
  }

  return (
    <>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Correo</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Último login</TableHead>
              <TableHead className="w-12 text-right">
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const isLastAdmin =
                m.role === 'school_admin' && m.status === 'active' && activeAdminCount <= 1;
              const isMe = m.userId === currentUserId;
              const canRevoke = !isLastAdmin;

              return (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.email}</TableCell>
                  <TableCell className="text-muted-foreground">{m.name ?? '—'}</TableCell>
                  <TableCell>{ROLE_LABELS[m.role] ?? m.role}</TableCell>
                  <TableCell>
                    {m.status === 'active' ? (
                      <StatusBadge tone="success">Activo</StatusBadge>
                    ) : (
                      <StatusBadge tone="warning">Pendiente</StatusBadge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(m.lastLoginAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" disabled={pending}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => setToRevoke(m)}
                          disabled={!canRevoke || pending}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 size-4" />
                          {isMe ? 'Salir del equipo' : 'Eliminar acceso'}
                        </DropdownMenuItem>
                        {isLastAdmin && (
                          <DropdownMenuItem disabled className="text-xs">
                            No se puede eliminar al último admin
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!toRevoke} onOpenChange={(open) => !open && setToRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revocar acceso</AlertDialogTitle>
            <AlertDialogDescription>
              {toRevoke?.email} dejará de poder iniciar sesión en este colegio. Esta acción no se
              puede deshacer (puedes invitarlo de nuevo después).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRevoke}
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? 'Revocando…' : 'Revocar acceso'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
