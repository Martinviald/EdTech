import Link from 'next/link';
import { ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BRAND } from '@/lib/brand';
import { ProductMockup } from './ProductMockup';
import { PRIMARY_CTA_HREF } from './content';

export function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      {/* Halo de fondo sutil */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 -z-10 flex justify-center"
      >
        <div className="h-72 w-[42rem] rounded-full bg-gradient-to-b from-primary/15 to-accent/10 blur-3xl" />
      </div>

      <div className="container grid items-center gap-12 py-16 md:py-24 lg:grid-cols-2 lg:gap-8">
        <div className="text-center lg:text-left">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            EdTech con IA · alineado a MINEDUC
          </span>

          <h1 className="mt-6 text-balance text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            {BRAND.tagline}
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-pretty text-lg text-muted-foreground lg:mx-0">
            Del DIA a decisiones pedagógicas en minutos, no semanas. Sin planillas, sin
            tabular a mano. {BRAND.name} convierte tus evaluaciones en inteligencia accionable.
          </p>

          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row lg:justify-start">
            <Button size="lg" className="w-full sm:w-auto" asChild>
              <Link href={PRIMARY_CTA_HREF}>
                Importa tu DIA gratis
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="w-full sm:w-auto" asChild>
              <a href="#como-funciona">Ver cómo funciona</a>
            </Button>
          </div>

          <p className="mt-5 flex items-center justify-center gap-2 text-sm text-muted-foreground lg:justify-start">
            <ShieldCheck className="h-4 w-4 text-success" />
            Gratis para empezar · sin tarjeta de crédito
          </p>
        </div>

        <div className="lg:pl-4">
          <ProductMockup />
        </div>
      </div>
    </section>
  );
}
