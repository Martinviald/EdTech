'use client';

import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { SEVERITY_LABELS, type UnitSeverity } from '@soe/types';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const SEVERITY_VARIANT: Record<UnitSeverity, 'destructive' | 'warning' | 'secondary'> = {
  high: 'destructive',
  medium: 'warning',
  low: 'secondary',
};

// Badge de gravedad con la explicación al pasar el mouse o al tocarlo.
//
// En la lista vive dentro del <Link> de la fila: el clic sobre el badge NO navega, abre la
// explicación (en un celular no hay hover, y sin esto el motivo sería invisible).
// Es un <span role="button"> y no un <button> porque un botón dentro de un <a> es
// HTML inválido. Sin `reason` es un badge plano.
export function SeverityBadge({
  severity,
  reason,
}: {
  severity: UnitSeverity;
  reason: string | null;
}) {
  const [open, setOpen] = useState(false);
  const label = SEVERITY_LABELS[severity];
  const badge = (
    <Badge variant={SEVERITY_VARIANT[severity]} className="shrink-0">
      {label}
    </Badge>
  );
  if (!reason) return badge;

  const toggle = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen((current) => !current);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') toggle(event);
  };

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <span
            role="button"
            tabIndex={0}
            onClick={toggle}
            onKeyDown={onKeyDown}
            aria-label={`${label}: ${reason}`}
            className="inline-flex shrink-0 cursor-help rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {badge}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-relaxed">
          <span className="font-medium">{label}.</span> {reason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
