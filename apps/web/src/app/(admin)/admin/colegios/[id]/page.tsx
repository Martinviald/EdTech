import type { Route } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getOrg, listMemberships } from '@/lib/adminApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MembershipsTable } from './MembershipsTable';

export const dynamic = 'force-dynamic';

export default async function AdminOrgDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [org, memberships] = await Promise.all([getOrg(id), listMemberships(id)]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={'/admin/colegios' as Route}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Colegios
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{org.name}</h1>
        <p className="text-sm text-muted-foreground">RBD {org.rbd ?? '—'}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Comuna</CardTitle>
          </CardHeader>
          <CardContent className="text-lg font-semibold">{org.commune ?? '—'}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Región</CardTitle>
          </CardHeader>
          <CardContent className="text-lg font-semibold">{org.region ?? '—'}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Miembros</CardTitle>
          </CardHeader>
          <CardContent className="text-lg font-semibold">{org.membershipCount}</CardContent>
        </Card>
      </div>

      <MembershipsTable orgId={id} rows={memberships} />
    </div>
  );
}
