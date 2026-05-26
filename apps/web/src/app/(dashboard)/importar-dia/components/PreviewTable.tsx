'use client';

import type { DiaItemPreview } from '@soe/types';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface PreviewTableProps {
  items: DiaItemPreview[];
}

export function PreviewTable({ items }: PreviewTableProps) {
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-4 text-center">
        No se encontraron items en el archivo.
      </p>
    );
  }

  return (
    <div className="max-h-96 overflow-auto rounded border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">#</TableHead>
            <TableHead className="w-24">Tipo</TableHead>
            <TableHead className="w-24">Clave</TableHead>
            <TableHead>Habilidad</TableHead>
            <TableHead>OA</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, idx) => (
            <TableRow key={idx}>
              <TableCell className="font-mono text-sm">
                {item.position}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs">
                  {formatType(item.type)}
                </Badge>
              </TableCell>
              <TableCell className="font-mono font-medium">
                {item.correctKey ?? '—'}
              </TableCell>
              <TableCell className="text-sm">
                {item.skill ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-sm">
                {item.oa ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function formatType(type: string): string {
  const map: Record<string, string> = {
    multiple_choice: 'Sel. multiple',
    true_false: 'V/F',
    open_ended: 'Abierta',
    oral_reading: 'Lectura oral',
    oral_expression: 'Exp. oral',
    writing: 'Escritura',
    listening: 'Comprension',
    matching: 'Asociacion',
    ordering: 'Ordenamiento',
    gap_fill: 'Completar',
  };
  return map[type] ?? type;
}
