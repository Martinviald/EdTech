import type { PrintRunAssessmentOption } from '@soe/types';

/** Etiqueta de una evaluación en los selectores de tirada: nombre + fecha. */
export function assessmentLabel(assessment: PrintRunAssessmentOption): string {
  const date = assessment.administeredAt ?? assessment.createdAt;
  const suffix = date ? ` · ${new Date(date).toLocaleDateString('es-CL')}` : '';
  return `${assessment.name ?? 'Evaluación sin nombre'}${suffix}`;
}
