import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { HeroSection } from '@/components/marketing/HeroSection';
import { TrustStrip } from '@/components/marketing/TrustStrip';
import { ProblemSection } from '@/components/marketing/ProblemSection';
import { FeaturesSection } from '@/components/marketing/FeaturesSection';
import { HowItWorksSection } from '@/components/marketing/HowItWorksSection';
import { AudienceSection } from '@/components/marketing/AudienceSection';
import { AiSection } from '@/components/marketing/AiSection';
import { PricingTeaser } from '@/components/marketing/PricingTeaser';
import { FinalCtaSection } from '@/components/marketing/FinalCtaSection';

export default async function LandingPage() {
  // Un usuario ya autenticado no debe ver la landing pública: lo enviamos al
  // resolver post-login (`/seleccionar-colegio`), que centraliza el destino
  // según org/rol. Consultar la sesión vuelve dinámica esta página (esperado).
  const session = await auth();
  if (session?.user) redirect(ROUTES.selectOrg);

  return (
    <>
      <HeroSection />
      <TrustStrip />
      <ProblemSection />
      <FeaturesSection />
      <HowItWorksSection />
      <AudienceSection />
      <AiSection />
      <PricingTeaser />
      <FinalCtaSection />
    </>
  );
}
