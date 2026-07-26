import { Badge } from '@/components/ui/badge';
import { getOrg } from '@/lib/adminApi';
import { SetPageTitle } from '@/components/layout/page-title-context';
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
      <SetPageTitle title={org.name} />
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">RBD {org.rbd ?? '—'}</p>
        {org.deletedAt ? <Badge variant="destructive">Dado de baja</Badge> : null}
      </div>

      <TabNav orgId={id} />

      {children}
    </div>
  );
}
