import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { RemedialMaterialModel } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/shared';
import { ROUTES } from '@/lib/routes';
import { REMEDIAL_STATUS_LABELS, REMEDIAL_STATUS_TONE, REMEDIAL_TYPE_LABELS } from './labels';

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Tarjeta de un material remedial en el banco. Enlaza al detalle (revisión). */
export function MaterialCard({ material }: { material: RemedialMaterialModel }) {
  const title =
    material.title ??
    `${REMEDIAL_TYPE_LABELS[material.type]} · ${material.nodeName ?? 'Sin habilidad'}`;

  return (
    <Link
      href={ROUTES.materialRemedialDetalle(material.id)}
      className="block rounded-lg outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Card className="h-full transition hover:border-primary/50 hover:shadow-sm">
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {REMEDIAL_TYPE_LABELS[material.type]}
            </span>
            <StatusBadge tone={REMEDIAL_STATUS_TONE[material.status]}>
              {REMEDIAL_STATUS_LABELS[material.status]}
            </StatusBadge>
          </div>
          <CardTitle className="text-base leading-snug">{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-end justify-between gap-2">
          <div className="space-y-1 text-sm text-muted-foreground">
            {material.nodeName ? <p>Habilidad: {material.nodeName}</p> : null}
            <p>Creado: {formatDate(material.createdAt)}</p>
          </div>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </CardContent>
      </Card>
    </Link>
  );
}
