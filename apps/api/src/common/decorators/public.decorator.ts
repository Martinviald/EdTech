import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marca una ruta (o controller) como accesible sin autenticación. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
