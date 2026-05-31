import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Card de métrica resumen reutilizable (H6.1/H6.7): título, valor grande y
 * subtítulo opcional. Sin estado → Server Component.
 */
export function SummaryCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {Icon ? (
          <div className="rounded-lg bg-muted p-2">
            <Icon className="size-5 text-muted-foreground" aria-hidden />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
