import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/** Restringe una ruta (o controller) a los roles indicados. Verificado por RolesGuard. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
