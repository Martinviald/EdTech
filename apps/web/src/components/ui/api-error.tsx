'use client';

import { WifiOff, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ApiErrorProps {
  type: 'connection' | 'generic';
  message?: string;
  onRetry?: () => void;
}

export function ApiError({ type, message, onRetry }: ApiErrorProps) {
  const isConnection = type === 'connection';

  return (
    <div className="flex flex-col items-center justify-center gap-5 py-20 text-center">
      <div className={`rounded-full p-4 ${isConnection ? 'bg-warning/15' : 'bg-destructive/10'}`}>
        {isConnection ? (
          <WifiOff className="h-8 w-8 text-warning" />
        ) : (
          <AlertCircle className="h-8 w-8 text-destructive" />
        )}
      </div>

      <div className="space-y-1.5 max-w-sm">
        <h2 className="text-lg font-semibold">
          {isConnection ? 'Sin conexión con el servidor' : 'Ocurrió un error inesperado'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {isConnection
            ? 'No se puede conectar con la API. Verifica que el servicio esté activo e intenta de nuevo.'
            : (message ?? 'Algo salió mal. Si el problema persiste, contacta al soporte.')}
        </p>
      </div>

      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Reintentar
        </Button>
      )}
    </div>
  );
}
