export const HEADER_ICON_VARIANTS = ['filled', 'outlined'] as const;
export type HeaderIconVariant = (typeof HEADER_ICON_VARIANTS)[number];

export const HEADER_ICON_TONES = [
  'primary',
  'success',
  'warning',
  'info',
  'destructive',
  'neutral',
] as const;
export type HeaderIconTone = (typeof HEADER_ICON_TONES)[number];

export const HEADER_ICON_TONE_CLASS: Record<HeaderIconVariant, Record<HeaderIconTone, string>> = {
  filled: {
    primary: 'bg-primary text-primary-foreground',
    success: 'bg-success text-success-foreground',
    warning: 'bg-warning text-warning-foreground',
    info: 'bg-info text-info-foreground',
    destructive: 'bg-destructive text-destructive-foreground',
    neutral: 'bg-muted text-foreground',
  },
  outlined: {
    primary: 'border border-primary/30 bg-primary/5 text-primary',
    success: 'border border-success/30 bg-success/5 text-success',
    warning: 'border border-warning/30 bg-warning/5 text-warning',
    info: 'border border-info/30 bg-info/5 text-info',
    destructive: 'border border-destructive/30 bg-destructive/5 text-destructive',
    neutral: 'border border-border bg-muted/40 text-muted-foreground',
  },
};
