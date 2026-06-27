import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { SlidersHorizontal, ChevronRight, Cpu } from 'lucide-react';
import { auth } from '@/auth';
import {
  canAccess,
  GRADING_SCALE_ROLES,
  LLM_SETTINGS_ROLES,
  type UserRole,
} from '@soe/types';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Hub de Configuración. Lista las áreas configurables a las que el usuario
 * tiene acceso. Hoy: Escalas de notas (H5.7). A medida que se agreguen más
 * opciones de configuración, se suman como nuevas entradas aquí.
 */
type ConfigOption = {
  href: string;
  label: string;
  description: string;
  icon: typeof SlidersHorizontal;
  roles: readonly UserRole[];
};

const CONFIG_OPTIONS: ConfigOption[] = [
  {
    href: '/configuracion/escalas',
    label: 'Escalas de notas',
    description:
      'Define cómo se convierten los porcentajes de logro en notas (1.0 — 7.0 u otra escala).',
    icon: SlidersHorizontal,
    roles: GRADING_SCALE_ROLES,
  },
  {
    href: '/configuracion/modelos-ia',
    label: 'Modelos de IA',
    description:
      'Elige el proveedor (Gemini/Claude) y el modelo que usa cada funcionalidad de IA.',
    icon: Cpu,
    roles: LLM_SETTINGS_ROLES,
  },
];

export default async function ConfiguracionPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const roles = session.user.roles;
  // Un platform_admin ve TODAS las opciones, igual que el bypass del RolesGuard en
  // el backend: su `roles` puede traer los de su org (sin 'platform_admin') cuando
  // además es miembro de un colegio, así que no basta con canAccess.
  const isAdmin = Boolean(session.user.isPlatformAdmin);
  const options = CONFIG_OPTIONS.filter((o) => isAdmin || canAccess(roles, o.roles));
  // Solo entra a la sección quien puede acceder a al menos una opción.
  if (options.length === 0) {
    redirect('/dashboard');
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configuración</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Ajustes de tu organización. Selecciona un área para configurarla.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((option) => {
          const Icon = option.icon;
          return (
            <Link key={option.href} href={option.href as Route} className="group">
              <Card className="transition-colors hover:border-primary/50 hover:bg-muted/40">
                <CardContent className="flex items-start gap-4 p-5">
                  <div className="bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="font-medium">{option.label}</h2>
                      <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
                    </div>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {option.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
