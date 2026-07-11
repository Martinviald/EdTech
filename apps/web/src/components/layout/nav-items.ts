import {
  BarChart3,
  BookOpen,
  Building2,
  ClipboardList,
  Cpu,
  FileText,
  FileUp,
  FolderTree,
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
  DASHBOARD_VIEWER_ROLES,
  AI_ANALYSIS_VIEWER_ROLES,
  REMEDIAL_VIEWER_ROLES,
  BENCHMARKING_VIEWER_ROLES,
  ANSWER_SHEET_IMPORT_ROLES,
  ESTABLISHMENT_REPORT_ROLES,
} from '@soe/types';

export type NavStatus = 'live' | 'soon';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  status: NavStatus;
  roles: readonly UserRole[];
  /** Si true, solo se muestra cuando el usuario es platform_admin (independiente de role). */
  requiresPlatformAdmin?: boolean;
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
        href: '/dashboard',
        label: 'Inicio',
        icon: LayoutDashboard,
        status: 'live',
        roles: ALL_ROLES,
      },
      {
        href: '/dashboard/my-classes',
        label: 'Mis cursos',
        icon: BookOpen,
        status: 'live',
        roles: ALL_STAFF_ROLES,
      },
      {
        href: '/evaluaciones',
        label: 'Evaluaciones',
        icon: ClipboardList,
        status: 'live',
        roles: DASHBOARD_VIEWER_ROLES,
      },
      {
        href: '/resultados',
        label: 'Panorama pedagógico',
        icon: BarChart3,
        status: 'live',
        roles: DASHBOARD_VIEWER_ROLES,
      },
      {
        href: '/analisis-ia',
        label: 'Análisis IA',
        icon: Sparkles,
        status: 'live',
        roles: AI_ANALYSIS_VIEWER_ROLES,
      },
      {
        href: '/material-remedial',
        label: 'Material Remedial',
        icon: Lightbulb,
        status: 'live',
        roles: REMEDIAL_VIEWER_ROLES,
      },
      {
        href: '/benchmarking',
        label: 'Benchmarking',
        icon: TrendingUp,
        status: 'live',
        roles: BENCHMARKING_VIEWER_ROLES,
      },
      {
        href: '/establecimiento/informe-oficial',
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
        href: '/importar',
        label: 'Importar',
        icon: FileUp,
        status: 'live',
        roles: ANSWER_SHEET_IMPORT_ROLES,
      },
      {
        href: '/banco-items',
        label: 'Banco de Instrumentos',
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
      },
      {
        // TKT-14: banco de ítems global (cross-instrumento, propio + global).
        href: '/banco-items/explorar',
        label: 'Banco de ítems',
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
      },
      {
        href: '/marcos-academicos',
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
        href: '/alumnos',
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
        href: '/organizacion',
        label: 'Mi Colegio',
        icon: Building2,
        status: 'live',
        roles: ['school_admin', 'academic_director', 'platform_admin'],
      },
      {
        href: '/equipo',
        label: 'Equipo',
        icon: UserCog,
        status: 'live',
        roles: ['school_admin', 'platform_admin'],
      },
      {
        href: '/configuracion',
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
    href: '/admin',
    label: 'Resumen',
    icon: LayoutDashboard,
    status: 'live',
    roles: ['platform_admin'],
    requiresPlatformAdmin: true,
  },
  {
    href: '/admin/colegios',
    label: 'Colegios',
    icon: School,
    status: 'live',
    roles: ['platform_admin'],
    requiresPlatformAdmin: true,
  },
  {
    href: '/admin/equipo',
    label: 'Equipo plataforma',
    icon: ShieldCheck,
    status: 'live',
    roles: ['platform_admin'],
    requiresPlatformAdmin: true,
  },
  {
    href: '/admin/modelos-ia',
    label: 'Modelos de IA',
    icon: Cpu,
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
  return NAV_ITEMS.filter((item) => item.roles.some((r) => roles.includes(r)));
}

/**
 * Grupos visibles para el usuario: cada grupo se filtra por sus items accesibles
 * (misma regla de unión de roles que `visibleNavItems`) y se descartan los grupos
 * que quedan sin items. Así un profesor no ve la sección "Administración" vacía.
 */
export function visibleNavGroups(roles: readonly UserRole[]): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.some((r) => roles.includes(r))),
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
