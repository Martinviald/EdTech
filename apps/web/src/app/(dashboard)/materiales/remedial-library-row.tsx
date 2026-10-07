import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import type { MaterialLibraryRemedialItem } from '@soe/types';
import { ROUTES } from '@/lib/routes';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { REMEDIAL_TYPE_LABELS } from '../material-remedial/components/labels';
import {
  LIBRARY_REMEDIAL_STATUS_LABELS,
  LIBRARY_REMEDIAL_STATUS_TONES,
  MATERIAL_ORIGIN_LABELS,
} from './labels';

/**
 * Fila de un material remedial que todavía no se abrió en el editor. Lleva a su
 * revisión (`/material-remedial/[id]`); al abrirlo en el editor pasa a listarse
 * como documento.
 */
export function RemedialLibraryRow({ item }: { item: MaterialLibraryRemedialItem }) {
  const { status, remedialType } = item.remedial;

  return (
    <div className="hover:bg-muted/50 flex items-center gap-4 px-4 py-3">
      <Sparkles className="text-muted-foreground size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <Link
          href={ROUTES.materialRemedialDetalle(item.id)}
          className="font-medium hover:underline"
        >
          {item.title}
        </Link>
        <p className="text-muted-foreground truncate text-sm">
          {REMEDIAL_TYPE_LABELS[remedialType]}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Badge variant="outline">{MATERIAL_ORIGIN_LABELS[item.origin]}</Badge>
          <StatusBadge tone={LIBRARY_REMEDIAL_STATUS_TONES[status]}>
            {LIBRARY_REMEDIAL_STATUS_LABELS[status]}
          </StatusBadge>
        </div>
      </div>
    </div>
  );
}
