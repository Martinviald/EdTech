import { GraduationCap } from 'lucide-react';
import { BRAND } from '@/lib/brand';
import { NAV_LINKS } from './content';

export function MarketingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-background">
      <div className="container flex flex-col gap-8 py-12 md:flex-row md:items-center md:justify-between">
        <div className="max-w-sm">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GraduationCap className="h-5 w-5" />
            </span>
            <span className="text-lg">{BRAND.name}</span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {BRAND.legalName}. Plataforma EdTech con IA para colegios chilenos.
          </p>
        </div>

        <nav className="flex flex-wrap gap-x-8 gap-y-3">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>

      <div className="border-t border-border">
        <div className="container flex flex-col items-center justify-between gap-2 py-6 text-xs text-muted-foreground sm:flex-row">
          <p>
            © {year} {BRAND.name}. Todos los derechos reservados.
          </p>
          <p>Hecho en Chile · alineado a MINEDUC</p>
        </div>
      </div>
    </footer>
  );
}
