import { Layers } from 'lucide-react';
import type { ComparabilityMeta } from '@soe/types';
import { AlertCallout } from '@/components/shared';

/**
 * Explica por qué una métrica agregada NO se está mostrando.
 *
 * Sin esto, un alcance no comparable dejaría un hueco mudo donde antes había un
 * número — y un vacío sin explicación se lee como un bug. El motivo lo redacta el
 * backend (`comparability.reason`), que es quien sabe cuántos instrumentos hay y por
 * qué no se pueden sumar.
 *
 * No renderiza nada cuando el alcance sí es agregable, o cuando simplemente no hay
 * datos (`kind: 'empty'`): ese caso ya tiene su propio `EmptyState`.
 */
export function ComparabilityNotice({
  comparability,
  className,
}: {
  comparability: ComparabilityMeta;
  className?: string;
}) {
  if (comparability.aggregatable || !comparability.reason) return null;

  return (
    <div className={className}>
      <AlertCallout tone="info" title="Resultados de varios instrumentos" icon={Layers}>
        {comparability.reason}
      </AlertCallout>
    </div>
  );
}
