import type { InstrumentFilterOption } from '../schemas/dashboard.schema';

/**
 * Alcance de la vista de trayectoria: la familia comparable que el usuario está
 * mirando (nivel → asignatura → medición). El curso NO entra acá: no se decide
 * contra el catálogo de instrumentos sino contra el de `class_groups`.
 *
 * Estos helpers son PUROS a propósito y viven en `packages/types` porque
 * `apps/web` no tiene runner de tests: la regla de "qué sigue siendo válido al
 * cambiar un filtro" es la parte que se puede equivocar en silencio, así que se
 * prueba sola en vez de quedar enterrada en un componente cliente.
 */
export type TrajectoryScope = {
  gradeId?: string;
  subjectId?: string;
  instrumentType?: string;
};

function instrumentMatchesScope(
  instrument: InstrumentFilterOption,
  scope: TrajectoryScope,
): boolean {
  return (
    (scope.gradeId === undefined || instrument.gradeId === scope.gradeId) &&
    (scope.subjectId === undefined || instrument.subjectId === scope.subjectId) &&
    (scope.instrumentType === undefined || instrument.type === scope.instrumentType)
  );
}

/** Instrumentos del catálogo que caen dentro del alcance (campos `undefined` = sin filtrar). */
export function instrumentsInScope(
  instruments: readonly InstrumentFilterOption[],
  scope: TrajectoryScope,
): InstrumentFilterOption[] {
  return instruments.filter((instrument) => instrumentMatchesScope(instrument, scope));
}

function scopeHasInstruments(
  instruments: readonly InstrumentFilterOption[],
  scope: TrajectoryScope,
): boolean {
  return instruments.some((instrument) => instrumentMatchesScope(instrument, scope));
}

/**
 * Poda el alcance dejando en `undefined` sólo lo que dejó de tener respaldo en el
 * catálogo. Respeta la jerarquía nivel → asignatura → medición: si un eslabón cae,
 * arrastra a los de abajo aunque por sí solos parecieran válidos (una medición que
 * existe para OTRA asignatura no salva a la asignatura que ya no existe).
 */
export function pruneTrajectoryScope(
  instruments: readonly InstrumentFilterOption[],
  scope: TrajectoryScope,
): TrajectoryScope {
  const supported: TrajectoryScope = {
    gradeId: undefined,
    subjectId: undefined,
    instrumentType: undefined,
  };

  if (scope.gradeId !== undefined) {
    if (!scopeHasInstruments(instruments, { gradeId: scope.gradeId })) return supported;
    supported.gradeId = scope.gradeId;
  }

  if (scope.subjectId !== undefined) {
    if (!scopeHasInstruments(instruments, { ...supported, subjectId: scope.subjectId })) {
      return supported;
    }
    supported.subjectId = scope.subjectId;
  }

  if (scope.instrumentType !== undefined) {
    if (!scopeHasInstruments(instruments, { ...supported, instrumentType: scope.instrumentType })) {
      return supported;
    }
    supported.instrumentType = scope.instrumentType;
  }

  return supported;
}
