import {
  Building2,
  Cpu,
  FolderTree,
  Gauge,
  Palette,
  ScanSearch,
  SlidersHorizontal,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';

import {
  AI_OBSERVABILITY_VIEWER_ROLES,
  ASSIGNMENTS_ROLES,
  canAccess,
  GRADING_SCALE_ROLES,
  LLM_SETTINGS_ROLES,
  ORG_ACADEMIC_ADMIN_ROLES,
  ORG_BRANDING_ROLES,
  REVIEW_SETTINGS_ROLES,
  STAFF_MANAGEMENT_ROLES,
  STUDENT_ROSTER_ROLES,
  TAXONOMY_ROLES,
  type UserRole,
} from '@soe/types';
import { ROUTES } from '@/lib/routes';

/**
 * Fuente única de las opciones del hub de Administración: las vistas de gestión
 * que ya no cuelgan del sidebar y se alcanzan desde `/administracion`. La
 * consumen la grilla del hub, el item único del sidebar (roles + paths que
 * marca como activo) y el encabezado de Configuración (su subconjunto).
 */
export type AdminHubOption = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  roles: readonly UserRole[];
  /** 'soon' = la vista aún no existe; la tarjeta se muestra deshabilitada. */
  status?: 'live' | 'soon';
};

/** Subconjunto que además se renderiza como pestañas dentro de `configuracion/*`. */
export const CONFIG_HUB_OPTIONS: readonly AdminHubOption[] = [
  {
    href: ROUTES.configEscalas,
    label: 'Escalas de notas',
    description: 'Define cómo se convierte el puntaje de una evaluación en nota.',
    icon: SlidersHorizontal,
    roles: GRADING_SCALE_ROLES,
  },
  {
    href: ROUTES.configModelosIa,
    label: 'Modelos de IA',
    description: 'Elige qué modelo atiende cada función de inteligencia artificial.',
    icon: Cpu,
    roles: LLM_SETTINGS_ROLES,
  },
  {
    href: ROUTES.configObservabilidadIa,
    label: 'Observabilidad IA',
    description: 'Consumo, costo y latencia de las funciones de IA.',
    icon: Gauge,
    roles: AI_OBSERVABILITY_VIEWER_ROLES,
  },
  {
    href: ROUTES.configIdentidad,
    label: 'Identidad del colegio',
    description: 'Logo, colores y textos que llevan tus materiales impresos.',
    icon: Palette,
    roles: ORG_BRANDING_ROLES,
  },
  {
    href: ROUTES.configRevisionHojas,
    label: 'Revisión de hojas',
    description: 'Cómo se confirman las marcas dudosas y qué dobles marcas se anulan solas.',
    icon: ScanSearch,
    roles: REVIEW_SETTINGS_ROLES,
  },
];

export const ADMIN_HUB_OPTIONS: readonly AdminHubOption[] = [
  {
    href: ROUTES.organizacion,
    label: 'Mi Colegio',
    description: 'Perfil institucional y estructura académica.',
    icon: Building2,
    roles: ORG_ACADEMIC_ADMIN_ROLES,
  },
  {
    href: ROUTES.equipo,
    label: 'Equipo',
    description: 'Invita docentes y coordinadores, gestiona sus roles y asígnales cursos.',
    icon: UserCog,
    // Unión: el academic_director no gestiona miembros pero sí asignaciones docentes,
    // que viven en este hub (`/equipo` lo lleva directo a esa pestaña).
    roles: [...new Set([...STAFF_MANAGEMENT_ROLES, ...ASSIGNMENTS_ROLES])],
  },
  {
    href: ROUTES.alumnos,
    label: 'Alumnos',
    description: 'Nómina de estudiantes del colegio.',
    icon: Users,
    roles: STUDENT_ROSTER_ROLES,
    status: 'soon',
  },
  {
    href: ROUTES.marcosAcademicos,
    label: 'Marcos Académicos',
    description: 'Currículums, marcos de evaluación y taxonomías de habilidades.',
    icon: FolderTree,
    roles: TAXONOMY_ROLES,
  },
  ...CONFIG_HUB_OPTIONS,
];

/**
 * Unión de los roles de todas las opciones: quien accede al menos a una ve el
 * item "Administración" en el sidebar.
 */
export const ADMIN_HUB_ROLES: readonly UserRole[] = [
  ...new Set(ADMIN_HUB_OPTIONS.flatMap((option) => option.roles)),
];

/**
 * Rutas que el item "Administración" del sidebar marca como activas, además de
 * la suya. `ROUTES.configuracion` cubre las tres sub-vistas de configuración.
 */
export const ADMIN_HUB_PATHS: readonly string[] = [
  ROUTES.organizacion,
  ROUTES.equipo,
  ROUTES.alumnos,
  ROUTES.marcosAcademicos,
  ROUTES.configuracion,
];

/**
 * Opciones a las que el usuario tiene acceso. `platform_admin` (por la tabla,
 * no por rol heredado) ve todas — mismo bypass que el RolesGuard del backend.
 */
export function accessibleHubOptions(
  options: readonly AdminHubOption[],
  roles: readonly UserRole[],
  isPlatformAdmin: boolean,
): AdminHubOption[] {
  return options.filter((option) => isPlatformAdmin || canAccess(roles, option.roles));
}
