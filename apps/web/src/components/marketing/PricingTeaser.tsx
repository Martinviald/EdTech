import Link from 'next/link';
import { Check, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { PRICING_PLANS, PRIMARY_CTA_HREF } from './content';

export function PricingTeaser() {
  return (
    <section id="precios" className="scroll-mt-20 border-t border-border bg-secondary/20">
      <div className="container py-20 md:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Empieza gratis. Crece cuando lo necesites.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Resolvemos el DIA sin costo. La inteligencia premium llega después.
          </p>
        </div>

        <div className="mx-auto mt-14 grid max-w-3xl gap-6 md:grid-cols-2">
          {PRICING_PLANS.map((plan) => (
            <div
              key={plan.name}
              className={cn(
                'relative flex flex-col rounded-2xl border bg-card p-8',
                plan.highlighted
                  ? 'border-primary shadow-lg shadow-primary/10'
                  : 'border-border',
              )}
            >
              {plan.highlighted && (
                <Badge className="absolute -top-3 left-8">Recomendado</Badge>
              )}
              <h3 className="text-lg font-semibold">{plan.name}</h3>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight">{plan.price}</span>
                {plan.priceNote && (
                  <span className="text-sm text-muted-foreground">{plan.priceNote}</span>
                )}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p>

              <ul className="mt-6 flex-1 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature.text} className="flex items-start gap-3 text-sm">
                    {feature.included ? (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    ) : (
                      <Minus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span
                      className={cn(
                        feature.included ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {feature.text}
                    </span>
                  </li>
                ))}
              </ul>

              <Button
                className="mt-8 w-full"
                variant={plan.highlighted ? 'default' : 'outline'}
                asChild
              >
                <Link href={PRIMARY_CTA_HREF}>{plan.ctaLabel}</Link>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
