import type { UserRole } from '../enums';
import { RESULTS_VIEWER_ROLES } from './results-dashboards';

// Calidad de instrumento/ítems (KR-20 + flags psicométricos + sugerencias de
// corrección deterministas, sin costo IA). Alias intencional de
// RESULTS_VIEWER_ROLES; el scoping por curso para profesores lo aplica el service.
export const INSTRUMENT_QUALITY_VIEWER_ROLES: readonly UserRole[] = RESULTS_VIEWER_ROLES;
