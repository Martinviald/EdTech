import {
  INSTRUMENT_APPLICATION_PERIODS,
  type InstrumentApplicationPeriod,
} from './schemas/instrument.schema';

/**
 * Comparabilidad de un alcance de resultados.
 *
 * Hermano de `analytics-capabilities.ts` y con la misma filosofía: la regla vive UNA vez
 * y se importa tanto en `api` (que decide qué emitir) como en `web` (que decide qué
 * pintar). No duplicar.
 *
 * El problema que resuelve: **no se agrega analítica sobre instrumentos que no son
 * comparables**. Un "% de logro promedio" de 10 evaluaciones distintas no aporta valor —
 * una prueba puede ser mucho más difícil que otra, y el promedio mezcla cosas que no
 * deben mezclarse. Peor: cada instrumento puede traer su propio corte de niveles
 * (`performance_bands`), así que agregar también mezcla ESCALAS, no sólo dificultades.
 *
 * Antes de este módulo la regla no existía en ninguna parte del código: el dashboard
 * detectaba el caso de instrumento único y, cuando no aplicaba, caía en silencio a un
 * corte legacy 40/70/85 que no era el de ningún instrumento del alcance.
 *
 * ⚠️ REGLA DE ESTE MÓDULO: ningún otro archivo re-deriva "¿esto es comparable?". Si
 * necesitas la respuesta, la pides acá.
 *
 * Ver docs/diseno-panorama-comparable.md §2.
 */

/**
 * Los cuatro niveles de comparabilidad, más los dos estados de borde.
 *
 * `single_assessment` y `single_instrument` son AGREGABLES: se puede emitir un número
 * único (% de logro, distribución, clasificación de alumnos) porque todos los resultados
 * salen de las mismas preguntas y del mismo corte.
 *
 * `instrument_family` y `period_series` son COMPARABLES pero NO agregables: se muestran
 * punto a punto, con su delta, nunca promediados entre sí.
 */
export const COMPARABILITY_KINDS = [
  'empty',
  'single_assessment',
  'single_instrument',
  'instrument_family',
  'period_series',
  'mixed',
] as const;
export type ComparabilityKind = (typeof COMPARABILITY_KINDS)[number];

const AGGREGATABLE_KINDS: readonly ComparabilityKind[] = ['single_assessment', 'single_instrument'];

/** ¿Se puede emitir un número agregado sobre este alcance? */
export function isAggregatable(kind: ComparabilityKind): boolean {
  return AGGREGATABLE_KINDS.includes(kind);
}

/** Datos de un instrumento del alcance, lo mínimo para decidir comparabilidad. */
export type ComparabilityInstrumentRef = {
  instrumentId: string;
  type: string;
  subjectId: string | null;
  gradeId: string | null;
  applicationPeriod: InstrumentApplicationPeriod | null;
  year: number | null;
};

export type ComparabilityMeta = {
  kind: ComparabilityKind;
  aggregatable: boolean;
  instrumentIds: string[];
  /** Clave N2 cuando todo el alcance pertenece a la misma familia. */
  familyKey: string | null;
  /** Por qué NO se puede agregar, en español y listo para pintar. `null` si sí se puede. */
  reason: string | null;
};

const NONE = '-';

/**
 * Clave de **familia de instrumento estándar** (nivel N2): el mismo instrumento a través
 * de los años. `year` es justamente lo que varía dentro de una familia, así que no entra.
 *
 * `instrument.version` TAMPOCO entra: es una capacidad que el producto no usa hoy, e
 * incluirla partiría la serie histórica cada vez que la Agencia publica una versión nueva
 * — que es justo cuando la comparación año a año importa. Si algún día se versionan
 * instrumentos, el punto de extensión es el resolver de baselines, no esta clave.
 */
export function buildInstrumentFamilyKey(ref: ComparabilityInstrumentRef): string {
  return [ref.type, ref.subjectId ?? NONE, ref.gradeId ?? NONE, ref.applicationPeriod ?? NONE].join(
    '|',
  );
}

/**
 * Clave de **serie de momentos** (nivel N3): el mismo instrumento dentro de un año, a
 * través de su ciclo de aplicación (diagnóstico → monitoreo → cierre). Acá lo que varía
 * es `applicationPeriod`, así que no entra.
 */
export function buildPeriodSeriesKey(ref: ComparabilityInstrumentRef): string {
  return [ref.type, ref.subjectId ?? NONE, ref.gradeId ?? NONE, ref.year ?? NONE].join('|');
}

/** El momento anterior del ciclo, o `null` si es el primero (o no declara momento). */
export function previousApplicationPeriod(
  period: InstrumentApplicationPeriod | null,
): InstrumentApplicationPeriod | null {
  if (!period) return null;
  const index = INSTRUMENT_APPLICATION_PERIODS.indexOf(period);
  return index > 0 ? (INSTRUMENT_APPLICATION_PERIODS[index - 1] ?? null) : null;
}

function allShare(
  refs: ComparabilityInstrumentRef[],
  key: (r: ComparabilityInstrumentRef) => string,
) {
  const first = key(refs[0]!);
  return refs.every((r) => key(r) === first) ? first : null;
}

/**
 * El corazón del módulo: dado el conjunto de instrumentos que quedaron dentro del alcance
 * filtrado, decide de qué nivel de comparabilidad se trata.
 *
 * `assessmentCount` es opcional y sólo sirve para distinguir N0 de N1 (una aplicación
 * concreta vs el mismo instrumento en varios cursos). Ambos son agregables, así que la
 * distinción es informativa: la usa la UI para titular la vista.
 */
export function resolveComparabilityKind(
  refs: ComparabilityInstrumentRef[],
  assessmentCount?: number,
): ComparabilityKind {
  if (refs.length === 0) return 'empty';
  if (refs.length === 1) {
    return assessmentCount === 1 ? 'single_assessment' : 'single_instrument';
  }
  if (allShare(refs, buildInstrumentFamilyKey) !== null) return 'instrument_family';
  if (allShare(refs, buildPeriodSeriesKey) !== null) return 'period_series';
  return 'mixed';
}

/**
 * Por qué el alcance no se puede resumir en un número, en español y sin jerga. Es lo que
 * la UI pinta en lugar del número que ya no existe — un vacío mudo se lee como un bug,
 * y ese fue justamente el problema del corte silencioso a 40/70/85.
 */
export function comparabilityReason(
  kind: ComparabilityKind,
  instrumentCount: number,
): string | null {
  switch (kind) {
    case 'mixed':
      return `Estás viendo ${instrumentCount} instrumentos distintos. Promediarlos en un solo número no es interpretable, porque unos son más difíciles que otros y cada uno tiene su propio corte de niveles. Elige una evaluación para ver sus resultados.`;
    case 'instrument_family':
      return 'Estás viendo el mismo instrumento en varios años. Se pueden comparar entre sí, pero no promediar en un solo número.';
    case 'period_series':
      return 'Estás viendo varios momentos del mismo instrumento. Se pueden comparar entre sí, pero no promediar en un solo número.';
    default:
      return null;
  }
}

/** Etiqueta corta del alcance, para encabezados y chips. */
export function comparabilityLabel(kind: ComparabilityKind): string {
  const labels: Record<ComparabilityKind, string> = {
    empty: 'Sin datos',
    single_assessment: 'Una evaluación',
    single_instrument: 'Un instrumento',
    instrument_family: 'Mismo instrumento, varios años',
    period_series: 'Varios momentos del año',
    mixed: 'Varios instrumentos',
  };
  return labels[kind];
}

/** Arma el `meta.comparability` completo a partir de los instrumentos del alcance. */
export function buildComparabilityMeta(
  refs: ComparabilityInstrumentRef[],
  assessmentCount?: number,
): ComparabilityMeta {
  const kind = resolveComparabilityKind(refs, assessmentCount);
  const familyKey = refs.length > 0 ? allShare(refs, buildInstrumentFamilyKey) : null;
  return {
    kind,
    aggregatable: isAggregatable(kind),
    instrumentIds: refs.map((r) => r.instrumentId),
    familyKey,
    reason: comparabilityReason(kind, refs.length),
  };
}

// ── Baselines comparables ────────────────────────────────────────────────────
// Contra qué se compara una unidad. Es el punto único donde vive esa decisión, y el
// que después reutiliza el motor proactivo (roadmap #3B, capa 2).

export const BASELINE_KINDS = ['previous_year', 'previous_period', 'org_same_instrument'] as const;
export type BaselineKind = (typeof BASELINE_KINDS)[number];

export type BaselineRef = {
  kind: BaselineKind;
  label: string;
  instrumentId: string | null;
  assessmentIds: string[];
  achievement: number | null;
  /** Diferencia en PUNTOS PORCENTUALES contra el baseline. Negativo = caída. */
  deltaPp: number | null;
};

/** Delta en puntos porcentuales, redondeado a 1 decimal. `null` si falta algún extremo. */
export function deltaInPoints(current: number | null, baseline: number | null): number | null {
  if (current == null || baseline == null) return null;
  return Number((current - baseline).toFixed(1));
}

// ── Severidad de una unidad comparable ───────────────────────────────────────

/**
 * Umbrales de concentración en la banda inferior del instrumento que determinan la
 * severidad de una unidad.
 *
 * Se expresan como % de alumnos, NO como % de logro: un corte absoluto de logro
 * (el viejo "curso bajo 60%") no significa lo mismo en instrumentos con cortes
 * distintos, que es justo lo que #1C corrige. "Cuántos alumnos quedaron en el nivel
 * más bajo de SU instrumento" sí es comparable entre instrumentos.
 */
export const SEVERITY_LOWEST_BAND_THRESHOLDS = { high: 40, medium: 25 } as const;

/**
 * Severidad de una unidad a partir de la concentración en su banda inferior.
 *
 * `null` cuando el instrumento no define bandas ni niveles: sin corte propio no hay
 * forma honesta de decir si está bien o mal, y ordenar por un número inventado es
 * exactamente el problema que este módulo existe para evitar. Esas unidades van al
 * final de la vista, ordenadas por recencia.
 *
 * Cuando exista el motor de alertas (roadmap #3B), la severidad pasa a ser el MÁXIMO
 * entre ésta y la del delta contra el baseline: el movimiento puede subir la
 * severidad, nunca bajarla.
 */
export function severityFromLowestBandShare(share: number | null): UnitSeverityValue | null {
  if (share == null) return null;
  if (share >= SEVERITY_LOWEST_BAND_THRESHOLDS.high) return 'high';
  if (share >= SEVERITY_LOWEST_BAND_THRESHOLDS.medium) return 'medium';
  return 'low';
}

type UnitSeverityValue = 'high' | 'medium' | 'low';

const SEVERITY_ORDER: Record<UnitSeverityValue, number> = { high: 0, medium: 1, low: 2 };

/** Orden de la vista: primero lo urgente; las unidades sin severidad, al final. */
export function compareSeverity(a: UnitSeverityValue | null, b: UnitSeverityValue | null): number {
  const rankA = a == null ? 3 : SEVERITY_ORDER[a];
  const rankB = b == null ? 3 : SEVERITY_ORDER[b];
  return rankA - rankB;
}

// ── Umbrales del catálogo de alertas ─────────────────────────────────────────

/**
 * Los cortes que disparan cada familia de alertas.
 *
 * ⚠️ DECISIÓN ABIERTA (D del diseño): estos valores son un punto de partida razonable,
 * no una calibración. Se afinan mirando datos reales antes de decidir si además deben
 * ser configurables por colegio. Viven acá —y no dispersos en el service— justamente
 * para que calibrarlos sea cambiar un número en un solo lugar.
 *
 * Ninguno es un corte absoluto de LOGRO: son concentración en la banda inferior del
 * propio instrumento, o caída en puntos porcentuales contra el comparable propio. Un
 * "curso bajo 60%" no significa lo mismo en dos instrumentos con cortes distintos.
 */
export const ALERT_THRESHOLDS = {
  /** % de alumnos del curso en la banda inferior del instrumento. */
  bandConcentration: { high: 40, medium: 25 },
  /** Caída en puntos porcentuales contra el baseline comparable. */
  dropPp: { high: 10, medium: 5 },
  /** Cuánto puede quedar un curso bajo el promedio de su propia unidad, en pp. */
  classBelowOrgPp: { high: 15, medium: 8 },
  /** Un eje se marca si queda estos pp bajo el promedio de su unidad. */
  skillGapPp: { high: 20, medium: 12 },
  /** % de acierto de un ítem bajo el cual se considera brecha de contenido. */
  itemCorrectRate: { high: 20, medium: 35 },
  /** Días desde la aplicación sin resultados para considerarla estancada. */
  staleAssessmentDays: 14,
} as const;
