import type { Route } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getOrg } from '@/lib/adminApi';
import { TabNav } from './TabNav';

export const dynamic = 'force-dynamic';

export default async function AdminOrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const org = await getOrg(id);

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
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
          {org.deletedAt ? (
            <Badge variant="destructive">Dado de baja</Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">RBD {org.rbd ?? '—'}</p>
      </div>

      <TabNav orgId={id} />

      {children}
    </div>
  );
}
