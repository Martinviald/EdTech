import * as React from 'react';

import { cn } from '@/lib/utils';

/** Tecla de un atajo de teclado, tal como se muestra en las leyendas de los paneles de revisión. */
function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
