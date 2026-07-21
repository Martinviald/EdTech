import { ShieldCheck } from 'lucide-react';
import { listPlatformAdmins } from '@/lib/adminApi';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/shared';
import { AddAdminDialog } from './AddAdminDialog';
import { RevokeButton } from './RevokeButton';

export const dynamic = 'force-dynamic';

export default async function AdminTeamPage() {
  const admins = await listPlatformAdmins();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Equipo plataforma</h1>
          <p className="text-sm text-muted-foreground">
            {admins.length} administradores con permisos globales.
          </p>
        </div>
        <AddAdminDialog />
      </div>

      {admins.length === 0 ? (
        <EmptyState
          title="Sin administradores"
          description="Agrega el primer platform admin."
          icon={ShieldCheck}
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Notas</TableHead>
                <TableHead>Desde</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.user.name}</TableCell>
                  <TableCell className="text-muted-foreground">{a.user.email}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {a.notes ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(a.grantedAt).toLocaleDateString('es-CL')}
                  </TableCell>
                  <TableCell>
                    <RevokeButton userId={a.userId} email={a.user.email} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
