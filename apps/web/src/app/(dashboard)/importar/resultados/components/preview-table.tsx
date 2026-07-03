'use client';

import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { AnswerSheetRowPreview } from '@soe/types';
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
  rows: AnswerSheetRowPreview[];
}

export function PreviewTable({ rows }: PreviewTableProps) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No hay filas para mostrar.</p>
    );
  }

  return (
    <div className="overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Fila</TableHead>
            <TableHead>Alumno</TableHead>
            <TableHead>RUT</TableHead>
            <TableHead className="w-32">Estado</TableHead>
            <TableHead className="w-28 text-right">Respuestas</TableHead>
            <TableHead>Errores</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const answeredCount = Object.values(row.answers).filter(
              (v) => v !== null && v !== '',
            ).length;
            const totalAnswers = Object.keys(row.answers).length;
            const hasErrors = row.errors.length > 0;
            return (
              <TableRow key={row.rowNumber}>
                <TableCell className="font-mono text-xs">
                  {row.rowNumber}
                </TableCell>
                <TableCell className="font-medium">
                  {row.studentFullName ?? (
                    <span className="text-muted-foreground italic">
                      Sin nombre
                    </span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {row.studentRut ?? '—'}
                </TableCell>
                <TableCell>
                  {row.matched ? (
                    <Badge
                      variant="outline"
                      className="border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
                    >
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      Encontrado
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
                    >
                      <AlertCircle className="mr-1 h-3 w-3" />
                      No encontrado
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right text-xs">
                  {answeredCount}
                  <span className="text-muted-foreground"> / {totalAnswers}</span>
                </TableCell>
                <TableCell className="text-xs">
                  {hasErrors ? (
                    <ul className="space-y-0.5 text-destructive">
                      {row.errors.map((e, i) => (
                        <li key={i}>
                          {e.field ? <strong>{e.field}: </strong> : null}
                          {e.message}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
