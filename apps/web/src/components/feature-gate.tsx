import { Lock } from 'lucide-react';
import { FEATURE_LABELS, type FeatureKey } from '@soe/types';
import { PageContainer, PageHeader, EmptyState } from '@/components/patterns';

/**
 * Aviso de feature paga no habilitada (H18.1 — gating de tier pago). Se muestra
 * en lugar del contenido cuando la org no tiene la feature en su plan. El gating
 * real lo impone el backend (`FeatureGuard`); esto es la cara visible (CTA de
 * upgrade) del modelo PLG.
 */
export function FeatureUpgradeNotice({ feature }: { feature: FeatureKey }) {
  const label = FEATURE_LABELS[feature];
  return (
    <PageContainer>
      <PageHeader title={label} description="Función del plan avanzado" />
      <EmptyState
        icon={Lock}
        title={`${label} no está incluida en tu plan`}
        description="Esta función forma parte del plan avanzado de la plataforma. Conversa con tu administrador o con el equipo comercial para habilitarla en tu colegio."
      />
    </PageContainer>
  );
}
