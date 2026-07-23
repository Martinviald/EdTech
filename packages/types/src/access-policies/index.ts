// Fuente única de verdad para los conjuntos de roles que controlan acceso a
// features/páginas/endpoints. Consumido tanto por guards backend (@Roles en
// apps/api) como por canAccess() inline en Server Components del frontend.
//
// Un archivo por dominio (ver .claude/rules/backend/05-rbac-guards.md) — si
// agregas una constante nueva, va en el archivo del dominio que gatea, no acá.
// Si el dominio todavía no tiene archivo, créalo. Nunca dupliques una lista de
// roles inline en un controller o página — importa la constante.

export * from './taxonomy';
export * from './staff-org';
export * from './import';
export * from './teacher-assignments';
export * from './class-groups';
export * from './sensitive-data';
export * from './item-bank';
export * from './grading-scales';
export * from './performance-bands';
export * from './results-dashboards';
export * from './item-analysis';
export * from './instrument-quality';
export * from './ai-analysis';
export * from './remedial';
export * from './benchmarking';
export * from './feature-management';
export * from './ai-observability';
export * from './llm-settings';
export * from './official-reports';
export * from './assistant';
