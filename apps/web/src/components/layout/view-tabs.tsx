import {
  ArrowLeftRight,
  Building2,
  FileQuestion,
  Grid3x3,
  Layers,
  LayoutDashboard,
  Library,
  Lightbulb,
  TrendingUp,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

import type { PageTab } from '@/components/shared';
import { ROUTES } from '@/lib/routes';

/**
 * Fuente única de las tabs de cada vista. La consumen tanto los `PageTabs` de la
 * página (vía `toPageTabs`) como los `children` del sidebar (href + label). Así
 * la lista de tabs no se duplica entre el sidebar y el encabezado de la vista.
 */
export type ViewTab = { href: string; label: string; icon: LucideIcon; exact?: boolean };

export const RESULTADOS_TABS: readonly ViewTab[] = [
  { href: ROUTES.resultados, label: 'Resumen', icon: LayoutDashboard, exact: true },
  { href: ROUTES.resultadosClasificacion, label: 'Clasificación', icon: Layers, exact: true },
  { href: ROUTES.resultadosHabilidades, label: 'Habilidades', icon: Lightbulb, exact: true },
  { href: ROUTES.resultadosMapaCalor, label: 'Mapa de calor', icon: Grid3x3, exact: true },
  { href: ROUTES.resultadosComparacion, label: 'Comparación', icon: ArrowLeftRight, exact: true },
  { href: ROUTES.resultadosProgresion, label: 'Progresión', icon: TrendingUp, exact: true },
];

export const ORGANIZACION_TABS: readonly ViewTab[] = [
  { href: ROUTES.organizacion, label: 'Información básica', icon: Building2, exact: true },
  { href: ROUTES.organizacionAsignaciones, label: 'Asignaciones docentes', icon: UsersRound },
];

export const BANCO_TABS: readonly ViewTab[] = [
  { href: ROUTES.bancoItems, label: 'Instrumentos', icon: Library, exact: true },
  { href: ROUTES.bancoItemsExplorar, label: 'Ítems', icon: FileQuestion },
];

/** Adapta las `ViewTab` al shape de `PageTabs` (icono como elemento renderizado). */
export function toPageTabs(tabs: readonly ViewTab[]): PageTab[] {
  return tabs.map((tab) => {
    const Icon = tab.icon;
    return { href: tab.href, label: tab.label, exact: tab.exact, icon: <Icon /> };
  });
}

/** Adapta las `ViewTab` a los `children` del sidebar (solo href + label). */
export function toNavChildren(tabs: readonly ViewTab[]): { href: string; label: string }[] {
  return tabs.map((tab) => ({ href: tab.href, label: tab.label }));
}
