import type { UserRole } from '../enums';
import { RESULTS_VIEWER_ROLES } from './results-dashboards';

// Análisis a nivel de ítem (tabla cruzada alumno × pregunta × habilidad ×
// contenido, distribución de respuestas y distractores). Alias intencional de
// RESULTS_VIEWER_ROLES — misma audiencia que los dashboards de resultados; el
// scoping por curso para profesores lo aplica el service.
export const ITEM_ANALYSIS_VIEWER_ROLES: readonly UserRole[] = RESULTS_VIEWER_ROLES;
