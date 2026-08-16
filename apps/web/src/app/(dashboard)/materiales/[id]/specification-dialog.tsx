'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Table2 } from 'lucide-react';
import type { DocumentSpecificationResponse } from '@soe/types';
import { apiClientGet } from '@/lib/api-client';
import { getDisplayMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCallout, EmptyState } from '@/components/shared';

/**
 * Especificación DERIVADA del material (Decisión G2): cobertura de OA y
 * habilidades calculada desde las etiquetas taxonómicas de sus preguntas.
 * Orienta el trabajo sin necesidad de promover el documento a instrumento.
 */
export function SpecificationDialog({ documentId }: { documentId: string }) {
  const [open, setOpen] = useState(false);
  const [spec, setSpec] = useState<DocumentSpecificationResponse | null>(null);

  useEffect(() => {
    if (!open) return;
    setSpec(null);
    apiClientGet<DocumentSpecificationResponse>(`/documents/${documentId}/specification`)
      .then(setSpec)
      .catch((error: unknown) => {
        toast.error(getDisplayMessage(error, 'No se pudo cargar la especificación'));
        setOpen(false);
      });
  }, [open, documentId]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" icon={Table2}>
          Especificación
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tabla de especificaciones</DialogTitle>
          <DialogDescription>
            Cobertura de objetivos y habilidades según las etiquetas de las preguntas del
            material.
          </DialogDescription>
        </DialogHeader>

        {spec === null ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : spec.totalItems === 0 ? (
          <EmptyState
            icon={Table2}
            title="Sin preguntas"
            description="Agrega preguntas del banco para ver la cobertura curricular del material."
          />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="secondary">{spec.totalItems} preguntas</Badge>
              <Badge variant="success">{spec.taggedItems} con etiqueta curricular</Badge>
              {spec.untaggedItems > 0 ? (
                <Badge variant="warning">{spec.untaggedItems} sin etiquetar</Badge>
              ) : null}
            </div>

            {spec.rows.length === 0 ? (
              <AlertCallout tone="info" title="Sin etiquetas curriculares">
                Ninguna pregunta del material tiene etiquetas de taxonomía todavía. Etiquétalas
                en el banco de contenido para obtener la especificación.
              </AlertCallout>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Objetivo / habilidad</TableHead>
                      <TableHead className="w-24">Etiqueta</TableHead>
                      <TableHead className="w-24 text-right">Preguntas</TableHead>
                      <TableHead className="w-40">Posiciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {spec.rows.map((row) => (
                      <TableRow key={`${row.nodeId}-${row.tagType}`}>
                        <TableCell>
                          <span className="font-medium">
                            {row.code ? `${row.code} · ` : ''}
                            {row.nodeName}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={row.tagType === 'primary' ? 'info' : 'outline'}>
                            {row.tagType === 'primary' ? 'Principal' : 'Secundaria'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{row.itemCount}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.itemPositions.join(', ')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
