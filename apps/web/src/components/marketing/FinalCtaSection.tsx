import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BRAND } from '@/lib/brand';
import { PRIMARY_CTA_HREF } from './content';

export function FinalCtaSection() {
  return (
    <section className="container py-20 md:py-28">
      <div className="relative overflow-hidden rounded-3xl border border-border bg-primary px-6 py-16 text-center text-primary-foreground sm:px-12">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl"
        />
        <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          Convierte tu próximo DIA en decisiones, no en planillas
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-pretty text-primary-foreground/80">
          Súmate a los colegios que ya usan {BRAND.name} para entender sus aprendizajes en
          minutos. Empezar es gratis.
        </p>
        <Button size="lg" variant="secondary" className="mt-8" asChild>
          <Link href={PRIMARY_CTA_HREF}>
            Importa tu DIA gratis
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
