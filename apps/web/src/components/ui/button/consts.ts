import type { LucideIcon } from 'lucide-react';

export const ButtonVariant = {
  Primary: 'default',
  Destructive: 'destructive',
  Outline: 'outline',
  Secondary: 'secondary',
  Ghost: 'ghost',
  Link: 'link',
} as const;
export type ButtonVariant = (typeof ButtonVariant)[keyof typeof ButtonVariant];

export const ButtonSize = {
  Default: 'default',
  Sm: 'sm',
  Lg: 'lg',
  Icon: 'icon',
} as const;
export type ButtonSize = (typeof ButtonSize)[keyof typeof ButtonSize];

export const ButtonAnimation = {
  None: 'none',
  Pulse: 'pulse',
} as const;
export type ButtonAnimation = (typeof ButtonAnimation)[keyof typeof ButtonAnimation];

export const ButtonIconPosition = {
  Start: 'start',
  End: 'end',
} as const;
export type ButtonIconPosition =
  (typeof ButtonIconPosition)[keyof typeof ButtonIconPosition];

export type { LucideIcon };
