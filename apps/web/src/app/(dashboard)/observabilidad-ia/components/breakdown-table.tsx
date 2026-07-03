import type { JSX } from 'react';
import type { AiCostBucket } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUsd, formatInt, formatLatency } from './format';

// ─────────────────────────────────────────────────────────────────────────────
// H19.25 — Tabla de desglose de costo (por origen, tipo o modelo). Reutilizable:
// recibe los buckets ya agregados por el backend (ordenados por costo).
// ─────────────────────────────────────────────────────────────────────────────

interface BreakdownTableProps {
  title: string;
  buckets: AiCostBucket[];
}

export function BreakdownTable({ title, buckets }: BreakdownTableProps): JSX.Element {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {buckets.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">Sin datos en el rango.</p>
        ) : (
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[140px]">Categoría</TableHead>
                  <TableHead className="text-right">N°</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                  <TableHead className="text-right">Latencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buckets.map((bucket) => (
                  <TableRow key={bucket.key}>
                    <TableCell className="font-medium leading-tight">{bucket.label}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatInt(bucket.count)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatUsd(bucket.totalCostUsd)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {formatLatency(bucket.avgLatencyMs)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
