import type { TaxonomyType } from '../schemas/taxonomy.schema';

/**
 * Naturaleza de un marco académico, para agrupar en la UI. NO es el `type`:
 * un marco no-oficial (creado por un colegio) siempre es "propio", sin importar
 * su `type`.
 */
export type TaxonomyKind = 'curriculum' | 'evaluacion' | 'externo' | 'propio';

export const TAXONOMY_KIND_GROUP_LABEL: Record<TaxonomyKind, string> = {
  curriculum: 'Currículum',
  evaluacion: 'Marco de evaluación',
  externo: 'Programa externo',
  propio: 'Propio del colegio',
};

const TYPE_LABEL: Record<TaxonomyType, string> = {
  mineduc: 'MINEDUC',
  dia: 'DIA',
  simce: 'SIMCE',
  paes: 'PAES',
  cambridge: 'Cambridge',
  aptus: 'Aptus',
  desafio: 'Desafío',
  custom: 'Personalizado',
};

const TYPE_KIND: Record<TaxonomyType, TaxonomyKind> = {
  mineduc: 'curriculum',
  dia: 'evaluacion',
  simce: 'evaluacion',
  paes: 'evaluacion',
  cambridge: 'externo',
  aptus: 'externo',
  desafio: 'externo',
  custom: 'propio',
};

/** Orden estable de los grupos para mostrar en la UI. */
export const TAXONOMY_KIND_ORDER: readonly TaxonomyKind[] = [
  'curriculum',
  'evaluacion',
  'externo',
  'propio',
];

/**
 * Clasifica un marco académico por su naturaleza para la UI. Un marco no-oficial
 * (de un colegio) SIEMPRE cae en "Propio del colegio". Nunca se rotula
 * "Currículum" salvo MINEDUC oficial.
 */
export function taxonomyKind(
  type: TaxonomyType,
  isOfficial: boolean,
): { kind: TaxonomyKind; groupLabel: string; typeLabel: string } {
  const kind: TaxonomyKind = isOfficial ? TYPE_KIND[type] : 'propio';
  return { kind, groupLabel: TAXONOMY_KIND_GROUP_LABEL[kind], typeLabel: TYPE_LABEL[type] };
}
