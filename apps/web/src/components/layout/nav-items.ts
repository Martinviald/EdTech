import {
  BarChart3,
  BookOpen,
  Building2,
  ClipboardList,
  Cpu,
  FileText,
  FileUp,
  FolderTree,
  GitCompareArrows,
  LayoutDashboard,
  Library,
  Lightbulb,
  School,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from '@soe/types';
import {
  canAccess,
  DASHBOARD_VIEWER_ROLES,
  AI_ANALYSIS_VIEWER_ROLES,
  AI_ANALYSIS_GENERATOR_ROLES,
  REMEDIAL_VIEWER_ROLES,
  BENCHMARKING_VIEWER_ROLES,
  ANSWER_SHEET_IMPORT_ROLES,
  ESTABLISHMENT_REPORT_ROLES,
} from '@soe/types';
import { ROUTES } from '@/lib/routes';
import { BANCO_TABS, ORGANIZACION_TABS, RESULTADOS_TABS, toNavChildren } from './view-tabs';

export type NavStatus = 'live' | 'soon';

/** Sub-destino de un item (= las tabs de esa vista). Se muestran en el flyout colapsado. */
export type NavChild = { href: string; label: string };

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  status: NavStatus;
  roles: readonly UserRole[];
  /** Si true, solo se muestra cuando el usuario es platform_admin (independiente de role). */
  requiresPlatformAdmin?: boolean;
  /** Tabs de la vista, para acceso rápido desde el flyout colapsado del sidebar. */
  children?: readonly NavChild[];
};

/** Sección del sidebar: agrupa items por propósito/frecuencia de uso. */
export type NavGroup = {
  id: string;
  label: string;
  items: readonly NavItem[];
};

const ALL_STAFF_ROLES = [
  'teacher',
  'homeroom_teacher',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
  'platform_admin',
] as const satisfies readonly UserRole[];

const ALL_ROLES = [
  'platform_admin',
  'foundation_director',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'teacher',
  'homeroom_teacher',
  'eval_coordinator',
  'guardian',
] as const satisfies readonly UserRole[];

/**
 * Navegación principal agrupada por propósito. El orden de los grupos refleja la
 * frecuencia de uso: Análisis (diario) → Contenido y datos (ocasional) →
 * Administración (rara). Cada item se filtra por rol (unión); un grupo sin items
 * visibles para el usuario se oculta completo (ver `visibleNavGroups`).
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'analisis',
    label: 'Análisis',
    items: [
      {
        href: ROUTES.dashboard,
        label: 'Inicio',
        icon: LayoutDashboard,
        status: 'live',
        roles: ALL_ROLES,
      },
      {
        href: ROUTES.myClasses,
        label: 'Mis cursos',
        icon: BookOpen,
        status: 'live',
        roles: ALL_STAFF_ROLES,
      },
      {
        href: ROUTES.evaluaciones,
        label: 'Evaluaciones',
        icon: ClipboardList,
        status: 'live',
        roles: DASHBOARD_VIEWER_ROLES,
      },
      {
        href: ROUTES.resultados,
        label: 'Panorama pedagógico',
        icon: BarChart3,
        status: 'live',
        roles: DASHBOARD_VIEWER_ROLES,
        children: toNavChildren(RESULTADOS_TABS),
      },
      {
        href: ROUTES.analisisIa,
        label: 'Análisis IA',
        icon: Sparkles,
        status: 'live',
        roles: AI_ANALYSIS_VIEWER_ROLES,
      },
      {
        // TKT-23: diagnóstico IA de la variación entre instrumentos comparables.
        href: ROUTES.compararInstrumentos,
        label: 'Comparar instrumentos',
        icon: GitCompareArrows,
        status: 'live',
        roles: AI_ANALYSIS_GENERATOR_ROLES,
      },
      {
        href: ROUTES.materialRemedial,
        label: 'Material Remedial',
        icon: Lightbulb,
        status: 'live',
        roles: REMEDIAL_VIEWER_ROLES,
      },
      {
        href: ROUTES.benchmarking,
        label: 'Benchmarking',
        icon: TrendingUp,
        status: 'live',
        roles: BENCHMARKING_VIEWER_ROLES,
      },
      {
        href: ROUTES.establecimientoInformeOficial,
        label: 'Informe establecimiento',
        icon: FileText,
        status: 'live',
        roles: ESTABLISHMENT_REPORT_ROLES,
      },
    ],
  },
  {
    id: 'contenido',
    label: 'Contenido y datos',
    items: [
      {
        href: ROUTES.importar,
        label: 'Importar',
        icon: FileUp,
        status: 'live',
        roles: ANSWER_SHEET_IMPORT_ROLES,
      },
      {
        href: ROUTES.bancoItems,
        label: 'Banco de contenido',
        icon: Library,
        status: 'live',
        roles: [
          'platform_admin',
          'school_admin',
          'academic_director',
          'eval_coordinator',
          'teacher',
          'homeroom_teacher',
        ],
        children: toNavChildren(BANCO_TABS),
      },
      {
        href: ROUTES.marcosAcademicos,
        label: 'Marcos Académicos',
        icon: FolderTree,
        status: 'live',
        roles: ['platform_admin', 'school_admin', 'academic_director'],
      },
    ],
  },
  {
    id: 'administracion',
    label: 'Administración',
    items: [
      {
        href: ROUTES.alumnos,
        label: 'Alumnos',
        icon: Users,
        status: 'soon',
        roles: [
          'homeroom_teacher',
          'school_admin',
          'academic_director',
          'cycle_director',
          'dept_head',
          'coordinator',
          'platform_admin',
        ],
      },
      {
        href: ROUTES.organizacion,
        label: 'Mi Colegio',
        icon: Building2,
        status: 'live',
        roles: ['school_admin', 'academic_director', 'platform_admin'],
        children: toNavChildren(ORGANIZACION_TABS),
      },
      {
        href: ROUTES.equipo,
        label: 'Equipo',
        icon: UserCog,
        status: 'live',
        roles: ['school_admin', 'platform_admin'],
      },
      {
        href: ROUTES.configuracion,
        label: 'Configuración',
        icon: Settings,
        status: 'live',
        roles: ['platform_admin', 'school_admin', 'academic_director'],
      },
    ],
  },
];

/** Lista plana de todos los items (compatibilidad con consumidores existentes). */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/**
 * Items visibles únicamente cuando el usuario es platform_admin (vía tabla
 * platform_admins, no por rol heredado). Se usan en el route group `(admin)`.
 */
export const ADMIN_NAV_ITEMS: readonly NavItem[] = [
  {
    href: ROUTES.admin,
    label: 'Resumen',
    icon: LayoutDashboard,
    status: 'live',
    roles: ['platform_admin'],
    requiresPlatformAdmin: true,
  },
  {
    href: ROUTES.adminColegios,
    label: 'Colegios',
    icon: School,
    status: 'live',
    roles: ['platform_admin'],
    requiresPlatformAdmin: true,
  },
  {
    href: ROUTES.adminInstrumentos,
    label: 'Instrumentos oficiales',
    icon: Library,
    status: 'live',
    roles: ['platform_admin'],
    requiresPlatformAdmin: true,
  },
  {
    href: ROUTES.adminEquipo,
    label: 'Equipo plataforma',
    icon: ShieldCheck,
    status: 'live',
    roles: ['platform_admin'],
    requiresPlatformAdmin: true,
  },
  {
    href: ROUTES.adminModelosIa,
    label: 'Modelos de IA',
    icon: Cpu,
    status: 'live',
    roles: ['platform_admin'],
    requiresPlatformAdmin: true,
  },
  {
    href: ROUTES.adminInstrumentosBandas,
    label: 'Niveles de logro',
    icon: BarChart3,
    status: 'live',
    roles: ['platform_admin'],
    requiresPlatformAdmin: true,
  },
];

/**
 * Items visibles para el usuario dado el conjunto de roles que tiene en su
 * org. Unión: un item aparece si AL MENOS UNO de los roles del usuario está
 * en `item.roles`. Coherente con la regla de autorización del backend.
 */
export function visibleNavItems(roles: readonly UserRole[]): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => canAccess(roles, item.roles));
}

/**
 * Grupos visibles para el usuario: cada grupo se filtra por sus items accesibles
 * (misma regla de unión de roles que `visibleNavItems`) y se descartan los grupos
 * que quedan sin items. Así un profesor no ve la sección "Administración" vacía.
 */
export function visibleNavGroups(roles: readonly UserRole[]): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canAccess(roles, item.roles)),
  })).filter((group) => group.items.length > 0);
}

export const ROLE_LABELS: Record<UserRole, string> = {
  platform_admin: 'Administrador(a) de plataforma',
  foundation_director: 'Director(a) de fundación',
  school_admin: 'Administrador(a) de colegio',
  academic_director: 'Director(a) académico(a)',
  cycle_director: 'Director(a) de ciclo',
  dept_head: 'Jefe(a) de departamento',
  coordinator: 'Coordinador(a)',
  teacher: 'Docente',
  homeroom_teacher: 'Profesor(a) jefe',
  eval_coordinator: 'Coordinador(a) de evaluación',
  guardian: 'Apoderado(a)',
};
