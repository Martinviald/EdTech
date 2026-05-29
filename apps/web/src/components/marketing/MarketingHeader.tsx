'use client';

import { useState } from 'react';
import Link from 'next/link';
import { GraduationCap, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { BRAND } from '@/lib/brand';
import { NAV_LINKS, PRIMARY_CTA_HREF } from './content';

function BrandMark() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <GraduationCap className="h-5 w-5" />
      </span>
      <span className="text-lg">{BRAND.name}</span>
    </Link>
  );
}

export function MarketingHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        <BrandMark />

        {/* Navegación desktop */}
        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Button variant="ghost" asChild>
            <Link href={PRIMARY_CTA_HREF}>Iniciar sesión</Link>
          </Button>
          <Button asChild>
            <Link href={PRIMARY_CTA_HREF}>Importa tu DIA gratis</Link>
          </Button>
        </div>

        {/* Navegación móvil */}
        <div className="md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Abrir menú">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetTitle className="sr-only">Menú</SheetTitle>
              <nav className="mt-8 flex flex-col gap-1">
                {NAV_LINKS.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="rounded-md px-3 py-2 text-base font-medium text-foreground transition-colors hover:bg-secondary"
                  >
                    {link.label}
                  </a>
                ))}
              </nav>
              <div className="mt-6 flex flex-col gap-3">
                <Button variant="outline" asChild onClick={() => setOpen(false)}>
                  <Link href={PRIMARY_CTA_HREF}>Iniciar sesión</Link>
                </Button>
                <Button asChild onClick={() => setOpen(false)}>
                  <Link href={PRIMARY_CTA_HREF}>Importa tu DIA gratis</Link>
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
