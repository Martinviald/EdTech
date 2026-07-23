'use client';

import { RotateCcw } from 'lucide-react';
import type { DiaConfirmResponse } from '@soe/types';
import { Button } from '@/components/ui/button';
import { AlertCallout } from '@/components/shared';

interface ConfirmStepProps {
  result: DiaConfirmResponse;
  onReset: () => void;
}

export function ConfirmStep({ result, onReset }: ConfirmStepProps) {
  return (
    <div className="space-y-4">
      <AlertCallout tone="success" title="Importación completada">
        <p>
          Se creó el instrumento con {result.itemsCreated} ítem
          {result.itemsCreated === 1 ? '' : 's'}.
        </p>
        <p className="mt-1 text-xs">
          ID del instrumento: <code className="font-mono">{result.instrumentId}</code>
        </p>
      </AlertCallout>

      <div className="flex justify-end">
        <Button onClick={onReset} variant="outline">
          <RotateCcw className="mr-2 h-4 w-4" />
          Importar otra pauta
        </Button>
      </div>
    </div>
  );
}
