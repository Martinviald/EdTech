// ─────────────────────────────────────────────────────────────────────────────
// Modelo de lectura de una pauta (rúbrica) con sus criterios y niveles anidados.
// Lo sirve `GET /api/rubrics/:id` y lo consume el modal de pauta del detalle de
// ítem. Los ítems referencian su pauta por `content.rubricId`.
// ─────────────────────────────────────────────────────────────────────────────

export type RubricLevelModel = {
  id: string;
  score: number;
  descriptor: string;
  examples: string[] | null;
};

export type RubricCriterionModel = {
  id: string;
  name: string;
  description: string | null;
  maxPoints: number;
  order: number;
  levels: RubricLevelModel[];
};

export type RubricModel = {
  id: string;
  name: string;
  type: 'analytic' | 'holistic';
  criteria: RubricCriterionModel[];
};
