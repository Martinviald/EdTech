'use client';

import { CheckCircle2, RotateCcw } from 'lucide-react';
import type { DiaConfirmResponse } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface ConfirmStepProps {
  result: DiaConfirmResponse;
  onReset: () => void;
}

export function ConfirmStep({ result, onReset }: ConfirmStepProps) {
  return (
    <div className="space-y-4">
      <Card className="border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20">
        <CardContent className="flex items-start gap-3 pt-6">
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-emerald-900 dark:text-emerald-200">
              Importacion completada
            </p>
            <p className="text-emerald-800 dark:text-emerald-300">
              Se creo el instrumento con {result.itemsCreated} item
              {result.itemsCreated === 1 ? '' : 's'}.
            </p>
            <p className="text-muted-foreground text-xs">
              ID del instrumento: <code className="font-mono">{result.instrumentId}</code>
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={onReset} variant="outline">
          <RotateCcw className="mr-2 h-4 w-4" />
          Importar otra pauta
        </Button>
      </div>
    </div>
  );
}
