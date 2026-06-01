import {
  BarChart3,
  BookOpen,
  Building2,
  ClipboardList,
  FileUp,
  FolderTree,
  LayoutDashboard,
  Library,
  School,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from '@soe/types';
import { DASHBOARD_VIEWER_ROLES } from '@soe/types';

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

export const NAV_ITEMS: readonly NavItem[] = [
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
    status: 'soon',
    roles: ALL_STAFF_ROLES,
  },
  {
    href: '/resultados',
    label: 'Resultados',
    icon: BarChart3,
    status: 'live',
    roles: DASHBOARD_VIEWER_ROLES,
  },
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
    href: '/marcos-academicos',
    label: 'Marcos Académicos',
    icon: FolderTree,
    status: 'live',
    roles: ['platform_admin', 'school_admin', 'academic_director'],
  },
  {
    href: '/banco-items',
    label: 'Banco de Ítems',
    icon: Library,
    status: 'live',
    roles: ['platform_admin', 'school_admin', 'academic_director', 'eval_coordinator', 'teacher', 'homeroom_teacher'],
  },
  {
    href: '/importar-dia',
    label: 'Importar DIA',
    icon: FileUp,
    status: 'live',
    roles: ['platform_admin', 'school_admin', 'academic_director', 'eval_coordinator'],
  },
  {
    href: '/importar-resultados',
    label: 'Importar resultados',
    icon: FileUp,
    status: 'live',
    roles: ['platform_admin', 'school_admin', 'academic_director', 'eval_coordinator'],
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
];

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
];

/**
 * Items visibles para el usuario dado el conjunto de roles que tiene en su
 * org. Unión: un item aparece si AL MENOS UNO de los roles del usuario está
 * en `item.roles`. Coherente con la regla de autorización del backend.
 */
export function visibleNavItems(roles: readonly UserRole[]): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.some((r) => roles.includes(r)));
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
