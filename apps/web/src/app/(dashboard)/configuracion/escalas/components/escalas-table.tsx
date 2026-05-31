import Link from 'next/link';
import type { Route } from 'next';
import type { GradingScaleResponseModel } from '@soe/types';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/EmptyState';
import { SCALE_TYPE_LABELS, formatGrade, formatThresholdPercent } from './scale-format';

export function EscalasTable({ scales }: { scales?: GradingScaleResponseModel[] }) {
  if (!scales || scales.length === 0) {
    return (
      <EmptyState
        title="Aún no hay escalas configuradas"
        description="Crea tu primera escala para definir cómo se convertirán los porcentajes de logro en notas chilenas (1.0 — 7.0) u otra escala."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead className="hidden sm:table-cell">Tipo</TableHead>
            <TableHead>Rango</TableHead>
            <TableHead className="hidden md:table-cell">Nota mínima de aprobación</TableHead>
            <TableHead className="hidden md:table-cell">Umbral</TableHead>
            <TableHead>Alcance</TableHead>
            <TableHead className="w-[80px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {scales.map((scale) => (
            <TableRow key={scale.id}>
              <TableCell className="font-medium">
                <div>{scale.name}</div>
                <div className="text-muted-foreground text-xs sm:hidden">
                  {SCALE_TYPE_LABELS[scale.type] ?? scale.type}
                </div>
              </TableCell>
              <TableCell className="hidden sm:table-cell text-sm">
                {SCALE_TYPE_LABELS[scale.type] ?? scale.type}
              </TableCell>
              <TableCell className="text-sm">
                {formatGrade(scale.minGrade)} — {formatGrade(scale.maxGrade)}
              </TableCell>
              <TableCell className="hidden md:table-cell text-sm">
                {formatGrade(scale.passingGrade)}
              </TableCell>
              <TableCell className="hidden md:table-cell text-sm">
                {formatThresholdPercent(scale.passingThreshold)}
              </TableCell>
              <TableCell>
                {scale.isGlobal ? (
                  <Badge variant="secondary">Global</Badge>
                ) : (
                  <Badge variant="outline">Mi colegio</Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Link
                  href={`/configuracion/escalas/${scale.id}` as Route}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Ver
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
