'use client';

import { AlertCircle, Loader2 } from 'lucide-react';
import type { DiaPreviewResponse } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PreviewTable } from '../components/PreviewTable';

interface PreviewStepProps {
  preview: DiaPreviewResponse;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

export function PreviewStep({ preview, onConfirm, onCancel, isPending }: PreviewStepProps) {
  const { items, warnings } = preview;
  const hasWarnings = warnings.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Badge variant="secondary" className="text-sm">
          {items.length} item{items.length === 1 ? '' : 's'} detectados
        </Badge>
        {hasWarnings && (
          <Badge variant="destructive" className="text-sm">
            {warnings.length} advertencia{warnings.length === 1 ? '' : 's'}
          </Badge>
        )}
      </div>

      {hasWarnings && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-amber-900 dark:text-amber-200">
              <AlertCircle className="h-4 w-4" />
              Advertencias
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900 dark:text-amber-200">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Items parseados</CardTitle>
        </CardHeader>
        <CardContent>
          <PreviewTable items={items} />
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isPending}>
          Cancelar
        </Button>
        <Button onClick={onConfirm} disabled={items.length === 0 || isPending}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isPending
            ? 'Creando instrumento...'
            : `Confirmar e importar ${items.length} item${items.length === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  );
}
