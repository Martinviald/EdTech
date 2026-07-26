import type { UserRole } from '../enums';

// Roles que pueden GESTIONAR el plan/features pagas de una org. Es una
// decisión de facturación a nivel plataforma → sólo platform_admin (un
// school_admin no debería habilitarse features pagas a sí mismo).
export const FEATURE_MANAGEMENT_ROLES: readonly UserRole[] = ['platform_admin'];
