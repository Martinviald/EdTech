import type { Route } from 'next';
import Link from 'next/link';
import { listOrgs } from '@/lib/adminApi';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/EmptyState';
import { School } from 'lucide-react';
import { CreateOrgDialog } from './CreateOrgDialog';

export const dynamic = 'force-dynamic';

export default async function AdminOrgsPage() {
  const data = await listOrgs({ limit: 100 });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Colegios</h1>
          <p className="text-sm text-muted-foreground">
            {data.total} colegios registrados en la plataforma.
          </p>
        </div>
        <CreateOrgDialog />
      </div>

      {data.items.length === 0 ? (
        <EmptyState
          title="Aún no hay colegios"
          description="Crea el primer colegio para empezar a gestionar membresías y configuración académica."
          icon={School}
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>RBD</TableHead>
                <TableHead>Comuna</TableHead>
                <TableHead>Dependencia</TableHead>
                <TableHead className="w-[100px]">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((org) => (
                <TableRow key={org.id}>
                  <TableCell className="font-medium">{org.name}</TableCell>
                  <TableCell className="font-mono text-xs">{org.rbd ?? '—'}</TableCell>
                  <TableCell>{org.commune ?? '—'}</TableCell>
                  <TableCell>{org.dependence ?? '—'}</TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/colegios/${org.id}` as Route}
                      className="text-sm text-primary underline-offset-4 hover:underline"
                    >
                      Ver
                    </Link>
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
