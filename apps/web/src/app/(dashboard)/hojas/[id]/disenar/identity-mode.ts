import type { SheetIdentityMode } from '@soe/types';

export type DesignIdentityMode = Extract<SheetIdentityMode, 'qr' | 'rut_bubbles'>;

export function parseIdentityModeParam(identidad: string | undefined): DesignIdentityMode {
  return identidad === 'rut' ? 'rut_bubbles' : 'qr';
}
