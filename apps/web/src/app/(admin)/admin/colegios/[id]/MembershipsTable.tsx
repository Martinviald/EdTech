'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Trash2, UserPlus } from 'lucide-react';
import { USER_ROLES, type UserRole } from '@soe/types';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ROLE_LABELS } from '@/components/layout/nav-items';
import {
  createAndGrantMembershipAction,
  grantMembershipAction,
  revokeMembershipAction,
  searchUsersAction,
} from '../actions';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type MembershipRow = {
  membership: { id: string; userId: string; role: string };
  user: { id: string; email: string; name: string };
};

type UserHit = { id: string; email: string; name: string };

export function MembershipsTable({
  orgId,
  rows,
}: {
  orgId: string;
  rows: MembershipRow[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Miembros</h2>
        <AddMemberDialog orgId={orgId} />
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Aún no hay miembros asignados.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <MembershipRowView key={row.membership.id} orgId={orgId} row={row} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function MembershipRowView({ orgId, row }: { orgId: string; row: MembershipRow }) {
  const [pending, startTransition] = useTransition();

  function handleRevoke() {
    if (!confirm(`Revocar acceso de ${row.user.email}?`)) return;
    startTransition(async () => {
      const result = await revokeMembershipAction(orgId, row.user.id, row.membership.role);
      if (result.ok) toast.success('Miembro revocado');
      else toast.error(result.error);
    });
  }

  const roleLabel = ROLE_LABELS[row.membership.role as UserRole] ?? row.membership.role;

  return (
    <TableRow>
      <TableCell className="font-medium">{row.user.name}</TableCell>
      <TableCell className="text-muted-foreground">{row.user.email}</TableCell>
      <TableCell>
        <Badge variant="secondary">{roleLabel}</Badge>
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRevoke}
          disabled={pending}
          aria-label="Revocar"
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function AddMemberDialog({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<UserHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<UserHit | null>(null);
  const [role, setRole] = useState<UserRole>('teacher');
  const [createMode, setCreateMode] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [pending, startTransition] = useTransition();

  function resetForm() {
    setQuery('');
    setHits([]);
    setSearched(false);
    setSelected(null);
    setRole('teacher');
    setCreateMode(false);
    setNewEmail('');
    setNewName('');
  }

  function handleSearch(q: string) {
    setQuery(q);
    setSelected(null);
    setCreateMode(false);
    if (q.trim().length < 2) {
      setHits([]);
      setSearched(false);
      return;
    }
    startTransition(async () => {
      const results = await searchUsersAction(q);
      setHits(results);
      setSearched(true);
    });
  }

  function startCreateMode() {
    setCreateMode(true);
    setNewEmail(EMAIL_REGEX.test(query.trim()) ? query.trim() : '');
    setNewName('');
  }

  function handleSubmitExisting() {
    if (!selected) {
      toast.error('Selecciona un usuario');
      return;
    }
    const fd = new FormData();
    fd.set('userId', selected.id);
    fd.set('role', role);
    startTransition(async () => {
      const result = await grantMembershipAction(orgId, fd);
      if (result.ok) {
        toast.success('Miembro agregado');
        setOpen(false);
        resetForm();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleSubmitCreate() {
    if (!EMAIL_REGEX.test(newEmail.trim())) {
      toast.error('Email inválido');
      return;
    }
    if (newName.trim().length < 2) {
      toast.error('Nombre requerido');
      return;
    }
    const fd = new FormData();
    fd.set('email', newEmail.trim());
    fd.set('name', newName.trim());
    fd.set('role', role);
    startTransition(async () => {
      const result = await createAndGrantMembershipAction(orgId, fd);
      if (result.ok) {
        toast.success(`Usuario ${result.user.email} creado y asignado`);
        setOpen(false);
        resetForm();
      } else {
        toast.error(result.error);
      }
    });
  }

  const noResults = searched && hits.length === 0 && query.trim().length >= 2 && !selected;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="mr-2 size-4" />
          Agregar miembro
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar miembro</DialogTitle>
          <DialogDescription>
            Busca al usuario por nombre o email y asignale un rol. Si no existe, podés crearlo
            desde acá.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="search">Usuario</Label>
            <Input
              id="search"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="email o nombre…"
              disabled={createMode}
            />
            {hits.length > 0 && !createMode ? (
              <div className="max-h-48 overflow-y-auto rounded-md border">
                {hits.map((hit) => (
                  <button
                    type="button"
                    key={hit.id}
                    onClick={() => {
                      setSelected(hit);
                      setQuery(hit.email);
                      setHits([]);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <div className="font-medium">{hit.name}</div>
                    <div className="text-xs text-muted-foreground">{hit.email}</div>
                  </button>
                ))}
              </div>
            ) : null}
            {noResults && !createMode ? (
              <button
                type="button"
                onClick={startCreateMode}
                className="flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-left text-sm text-muted-foreground hover:border-primary hover:text-foreground"
              >
                <UserPlus className="size-4" aria-hidden />
                <span>
                  No encontramos a <span className="font-medium">{query}</span>.{' '}
                  <span className="text-primary underline-offset-4 hover:underline">Crear nuevo usuario</span>
                </span>
              </button>
            ) : null}
            {selected && !createMode ? (
              <p className="text-xs text-muted-foreground">
                Seleccionado: <span className="font-medium">{selected.email}</span>
              </p>
            ) : null}
          </div>

          {createMode ? (
            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Nuevo usuario
              </p>
              <div className="space-y-2">
                <Label htmlFor="new-email">Email</Label>
                <Input
                  id="new-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="nombre@colegio.cl"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-name">Nombre completo</Label>
                <Input
                  id="new-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nombre Apellido"
                  minLength={2}
                  required
                />
              </div>
              <button
                type="button"
                onClick={() => setCreateMode(false)}
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                ← Volver a buscar
              </button>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="role">Rol</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger id="role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {USER_ROLES.filter((r) => r !== 'guardian' && r !== 'platform_admin').map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r as UserRole]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          {createMode ? (
            <Button onClick={handleSubmitCreate} disabled={pending}>
              {pending ? 'Creando…' : 'Crear y agregar'}
            </Button>
          ) : (
            <Button onClick={handleSubmitExisting} disabled={pending || !selected}>
              {pending ? 'Guardando…' : 'Agregar'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
