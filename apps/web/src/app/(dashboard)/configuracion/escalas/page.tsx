import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { canAccess, GRADING_SCALE_ROLES, type GradingScaleListResponse } from '@soe/types';
import { EscalasTable } from './components/escalas-table';

export default async function EscalasPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect('/login');
  if (!canAccess(session.user.roles, GRADING_SCALE_ROLES)) {
    redirect('/dashboard');
  }

  const scales = await apiGet<GradingScaleListResponse>('/grading-scales?limit=50');
  // El backend devuelve { data, total, page, limit }; si por alguna razón llega
  // un payload sin `data`, no reventamos la vista — mostramos el estado vacío.
  const scaleList = scales?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={'/configuracion' as Route} className="hover:text-foreground">
          Configuración
        </Link>
        <span>/</span>
        <span>Escalas de notas</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Escalas de notas</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Configura cómo se convierten los porcentajes de logro en notas. Las escalas globales son
            compartidas por todos los colegios; las propias de tu organización solo aplican a tus
            evaluaciones.
          </p>
        </div>
        <Button asChild>
          <Link href={'/configuracion/escalas/nueva' as Route}>
            <Plus className="mr-2 size-4" />
            Nueva escala
          </Link>
        </Button>
      </div>

      <EscalasTable scales={scaleList} />
    </div>
  );
}
