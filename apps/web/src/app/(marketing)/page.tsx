import { HeroSection } from '@/components/marketing/HeroSection';
import { TrustStrip } from '@/components/marketing/TrustStrip';
import { ProblemSection } from '@/components/marketing/ProblemSection';
import { FeaturesSection } from '@/components/marketing/FeaturesSection';
import { HowItWorksSection } from '@/components/marketing/HowItWorksSection';
import { AudienceSection } from '@/components/marketing/AudienceSection';
import { AiSection } from '@/components/marketing/AiSection';
import { PricingTeaser } from '@/components/marketing/PricingTeaser';
import { FinalCtaSection } from '@/components/marketing/FinalCtaSection';

export default function LandingPage() {
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
