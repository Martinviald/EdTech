import {
  BarChart3,
  BookOpen,
  Building2,
  ClipboardList,
  FolderTree,
  LayoutDashboard,
  Settings,
  Upload,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from '@soe/types';

export type NavStatus = 'live' | 'soon';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  status: NavStatus;
  roles: readonly UserRole[];
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
    href: '/cursos',
    label: 'Cursos',
    icon: BookOpen,
    status: 'soon',
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
    status: 'soon',
    roles: [...ALL_STAFF_ROLES, 'foundation_director'],
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
    href: '/importar',
    label: 'Importar',
    icon: Upload,
    status: 'soon',
    roles: ['school_admin', 'academic_director', 'platform_admin'],
  },
  {
    href: '/organizacion',
    label: 'Mi Colegio',
    icon: Building2,
    status: 'live',
    roles: ['school_admin', 'academic_director', 'platform_admin'],
  },
  {
    href: '/curriculum',
    label: 'Currículum',
    icon: FolderTree,
    status: 'live',
    roles: ['platform_admin', 'school_admin', 'academic_director'],
  },
  {
    href: '/configuracion',
    label: 'Configuración',
    icon: Settings,
    status: 'soon',
    roles: ALL_ROLES,
  },
];

export function visibleNavItems(role: UserRole): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
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
