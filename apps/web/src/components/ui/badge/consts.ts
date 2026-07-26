export const BadgeVariant = {
  Default: 'default',
  Secondary: 'secondary',
  Destructive: 'destructive',
  Outline: 'outline',
  Success: 'success',
  Warning: 'warning',
  Info: 'info',
  LevelInsufficient: 'level-insufficient',
  LevelElementary: 'level-elementary',
  LevelAdequate: 'level-adequate',
  LevelAdvanced: 'level-advanced',
} as const;
export type BadgeVariant = (typeof BadgeVariant)[keyof typeof BadgeVariant];
