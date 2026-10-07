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
 * `instrument_family`, `period_series` e `instrument_history` son COMPARABLES pero NO
 * agregables: se muestran punto a punto, con su delta, nunca promediados entre sí.
 */
export const COMPARABILITY_KINDS = [
  'empty',
  'single_assessment',
  'single_instrument',
  'instrument_family',
  'period_series',
  'instrument_history',
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
  /** Línea de prueba (`instruments.track_id`). Null = la prueba es la asignatura. */
  trackId: string | null;
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
 * Las claves de familia distinguen la línea de prueba (M1 ≠ M2 dentro de MATH). El segmento
 * solo se agrega cuando hay línea: un instrumento sin línea conserva EXACTAMENTE la clave de
 * siempre, así que las series y baselines ya calculadas no cambian.
 */
function withTrack(key: string, ref: ComparabilityInstrumentRef): string {
  return ref.trackId ? `${key}|track:${ref.trackId}` : key;
}

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
  return withTrack(
    [ref.type, ref.subjectId ?? NONE, ref.gradeId ?? NONE, ref.applicationPeriod ?? NONE].join('|'),
    ref,
  );
}

/**
 * Clave de **serie de momentos** (nivel N3): el mismo instrumento dentro de un año, a
 * través de su ciclo de aplicación (diagnóstico → monitoreo → cierre). Acá lo que varía
 * es `applicationPeriod`, así que no entra.
 */
export function buildPeriodSeriesKey(ref: ComparabilityInstrumentRef): string {
  return withTrack(
    [ref.type, ref.subjectId ?? NONE, ref.gradeId ?? NONE, ref.year ?? NONE].join('|'),
    ref,
  );
}

/**
 * Clave de **historia del instrumento** (nivel N4): la misma medición (tipo + asignatura
 * + nivel) a lo largo de TODAS sus aplicaciones — varían el año Y el momento del ciclo.
 * Es la unión de N2 y N3 sobre la misma familia base.
 *
 * No es agregable (nunca se promedia entre puntos), pero tampoco es `mixed`: no mezcla
 * asignaturas ni tipos de instrumento, así que la trayectoria punto a punto sí se lee.
 * Es lo que grafica la vista de Trayectoria en su eje "Trayectoria".
 */
export function buildInstrumentHistoryKey(ref: ComparabilityInstrumentRef): string {
  return withTrack([ref.type, ref.subjectId ?? NONE, ref.gradeId ?? NONE].join('|'), ref);
}

/**
 * ¿Se pueden comparar dos evaluaciones lado a lado? Sí cuando sus instrumentos miden lo
 * mismo (tipo, asignatura, grado y rama electiva): la misma historia de instrumento, en
 * cualquier año o momento. Es la regla del comparador de evaluaciones, con y sin IA.
 */
export function areInstrumentsComparable(
  a: ComparabilityInstrumentRef,
  b: ComparabilityInstrumentRef,
): boolean {
  return buildInstrumentHistoryKey(a) === buildInstrumentHistoryKey(b);
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
  if (allShare(refs, buildInstrumentHistoryKey) !== null) return 'instrument_history';
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
    case 'instrument_history':
      return 'Estás viendo la misma medición a lo largo de varios años y momentos del ciclo. Se pueden comparar punto a punto, pero no promediar en un solo número.';
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
    instrument_history: 'Misma medición, historia completa',
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

/** Lo mínimo de una banda que hace falta para ubicar un % de logro en ella. */
export type SeverityBand = {
  key: string;
  label: string;
  order: number;
  minThreshold: number; // 0..1 inclusivo
  maxThreshold: number; // 0..1 exclusivo, salvo la banda superior
};

/**
 * Banda del instrumento en la que cae un % de logro (0..100).
 *
 * Es la misma regla que clasifica a cada alumno (`classifyByBands`): rango
 * `[min, max)` con la banda superior cerrada arriba. Se repite acá en vez de
 * importarla para que este módulo no dependa de `utils/`.
 */
export function bandForAchievement<B extends SeverityBand>(
  achievement: number | null,
  bands: readonly B[] | null | undefined,
): B | null {
  if (achievement == null || !bands || bands.length === 0) return null;
  const p = Math.max(0, Math.min(1, achievement / 100));
  const sorted = [...bands].sort((a, b) => a.order - b.order);
  const top = sorted[sorted.length - 1]!;
  for (const band of sorted) {
    const isTop = band === top;
    if (p >= band.minThreshold && (p < band.maxThreshold || (isTop && p <= band.maxThreshold))) {
      return band;
    }
  }
  return null;
}

/**
 * Severidad de una evaluación o unidad: la banda de SU instrumento en la que cae el
 * promedio de logro.
 *
 * Es el mismo criterio con el que se pintan las habilidades y los nodos, así que la
 * gravedad y los colores del detalle no se contradicen. No es un corte absoluto de
 * logro (el viejo "curso bajo 60%" que #1C retiró): el umbral es el del instrumento,
 * y un 55% puede ser grave en una prueba y leve en otra.
 *
 *  - banda inferior → `high`
 *  - banda superior → `low`
 *  - bandas intermedias → `medium` (un instrumento binario, como el DIA Diagnóstico,
 *    nunca da `medium`)
 *
 * `null` cuando el instrumento no define al menos dos bandas o no hay promedio: sin
 * corte propio no hay forma honesta de decir si está bien o mal. Esas unidades van al
 * final de la vista, ordenadas por recencia.
 *
 * La concentración de alumnos en la banda inferior sigue existiendo como dato y como
 * alerta (`ALERT_THRESHOLDS.bandConcentration`), pero ya no gobierna la severidad.
 */
export function severityFromAverageBand(
  achievement: number | null,
  bands: readonly SeverityBand[] | null | undefined,
): UnitSeverityValue | null {
  if (!bands || bands.length < 2) return null;
  const band = bandForAchievement(achievement, bands);
  if (!band) return null;
  const orders = bands.map((b) => b.order);
  if (band.order === Math.min(...orders)) return 'high';
  if (band.order === Math.max(...orders)) return 'low';
  return 'medium';
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
  /**
   * Alertas relativas a la muestra de colegios (docs/diseno-benchmarking-en-contexto.md §9.4):
   * exigen POSICIÓN (bajo el p25 / p10 de los colegios) y MAGNITUD (Δ en pp) a la vez.
   */
  cohort: {
    belowSamplePp: { high: 10, medium: 5 },
    /** Un eje: bajo el p25/p10 de los colegios en ese nodo y estos pp bajo la muestra. */
    skillBelowSamplePp: { high: 20, medium: 12 },
    /** % en la banda inferior que supera al de la muestra en estos pp. */
    bandConcentrationAbovePp: { high: 20, medium: 10 },
    /** % de acierto de un ítem bajo el de la muestra en estos pp. */
    itemBelowSamplePp: { high: 25, medium: 15 },
    /** Bajo este |Δ| (pp) el resultado se considera similar al de la muestra. */
    similarPp: 5,
  },
} as const;

/**
 * Tope de alertas que viajan en la respuesta del panorama.
 *
 * La banda pliega en 4 y deja desplegar el resto; 20 cubre el desplegado sin mandar
 * cientos. El corte se aplica DESPUÉS del ranking por severidad y alumnos afectados,
 * así que lo que se pierde es siempre lo menos grave, y `alertsTotal` conserva el
 * conteo real.
 */
export const MAX_DASHBOARD_ALERTS = 20;
