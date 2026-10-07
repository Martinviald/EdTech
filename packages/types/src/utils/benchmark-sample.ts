import type {
  ItemSampleStat,
  BenchmarkBandCount,
  BenchmarkSkillAggregate,
  SampleSkillStat,
  TypicalZone,
} from '../schemas/benchmark.schema';
import { achievementPct, addTally, emptyTally, type AchievementTally } from './achievement';

/**
 * Cálculos puros de la muestra de benchmarking (docs/diseno-benchmarking-en-contexto.md §5).
 * Sin DB: los usa la API para armar la muestra y las alertas relativas, y se testean solos.
 */

/**
 * Fila de un colegio en la muestra de un instrumento (lo que aporta `benchmark_aggregates`).
 * `scoreSum` / `maxSum` es su tally; `avgAchievement` es el % del colegio (= tally) y sólo se
 * usa para los percentiles, que se calculan sobre el % de cada colegio.
 */
export type SampleSourceRow = {
  studentCount: number;
  scoreSum: number;
  maxSum: number;
  avgAchievement: number | null;
  bandCounts: BenchmarkBandCount[] | null;
  perSkill: BenchmarkSkillAggregate[] | null;
};

/** Agregado de la muestra sin la identidad (instrumento, alcance, etiqueta, fecha). */
export type SampleAggregate = {
  schoolCount: number;
  studentCount: number;
  avgAchievement: number | null;
  p10: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  bandCounts: BenchmarkBandCount[];
  perSkill: SampleSkillStat[];
};

/** "2 colegios · 103 alumnos": tamaño de una muestra, siempre visible junto al contraste. */
export function sampleSizeLabel(sample: { schoolCount: number; studentCount: number }): string {
  const schools = `${sample.schoolCount} ${sample.schoolCount === 1 ? 'colegio' : 'colegios'}`;
  const students = `${sample.studentCount} ${sample.studentCount === 1 ? 'alumno' : 'alumnos'}`;
  return `${schools} · ${students}`;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Percentil `p` (0..100) con interpolación lineal sobre un array ordenado ascendente. */
export function percentileOf(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return round2(sorted[0]!);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return round2(sorted[low]!);
  const weight = rank - low;
  return round2(sorted[low]! * (1 - weight) + sorted[high]! * weight);
}

/**
 * Rango percentil de `value` dentro de `values` (0..100): % de valores estrictamente
 * menores más la mitad de los iguales.
 */
export function percentileRank(values: readonly number[], value: number | null): number | null {
  if (value === null || values.length === 0) return null;
  let below = 0;
  let equal = 0;
  for (const v of values) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  return round2(((below + equal / 2) / values.length) * 100);
}

/** Dónde queda `value` frente a la zona típica [p25, p75]. */
export function classifyTypicalZone(
  value: number | null,
  p25: number | null,
  p75: number | null,
): TypicalZone | null {
  if (value === null || p25 === null || p75 === null) return null;
  if (value < p25) return 'below';
  if (value > p75) return 'above';
  return 'within';
}

/** Diferencia en pp `value − sample`, redondeada a 2 decimales. */
export function sampleDeltaPp(value: number | null, sample: number | null): number | null {
  if (value === null || sample === null) return null;
  return round2(value - sample);
}

/** Suma los conteos por clave de banda; conserva etiqueta y orden, ordena por `order`. */
export function sumBandCounts(
  lists: readonly (readonly BenchmarkBandCount[] | null)[],
): BenchmarkBandCount[] {
  const byKey = new Map<string, BenchmarkBandCount>();
  for (const list of lists) {
    for (const band of list ?? []) {
      const acc = byKey.get(band.bandKey);
      if (acc) acc.count += band.count;
      else byKey.set(band.bandKey, { ...band });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.order - b.order);
}

function sortedAscending(values: number[]): number[] {
  return values.sort((a, b) => a - b);
}

function pctOfTally(tally: AchievementTally): number | null {
  const pct = achievementPct(tally);
  return pct === null ? null : round2(pct);
}

/**
 * Por nodo: % de la muestra = Σ puntaje ÷ Σ máximo de los colegios (docs/diseno-logro-unificado-
 * y-cohorte.md §3.1) y p10/p25 sobre el % de cada colegio.
 */
export function aggregateSampleSkills(rows: readonly SampleSourceRow[]): SampleSkillStat[] {
  const byNode = new Map<
    string,
    {
      nodeName: string;
      tally: AchievementTally;
      schoolValues: number[];
      students: number;
      schools: number;
    }
  >();
  for (const row of rows) {
    for (const skill of row.perSkill ?? []) {
      let acc = byNode.get(skill.nodeId);
      if (!acc) {
        acc = {
          nodeName: skill.nodeName,
          tally: emptyTally(),
          schoolValues: [],
          students: 0,
          schools: 0,
        };
        byNode.set(skill.nodeId, acc);
      }
      addTally(acc.tally, { scoreSum: skill.scoreSum, maxSum: skill.maxSum });
      if (skill.achievement !== null) acc.schoolValues.push(skill.achievement);
      acc.students += skill.studentCount;
      acc.schools += 1;
    }
  }

  const result: SampleSkillStat[] = [];
  for (const [nodeId, acc] of byNode) {
    const sorted = sortedAscending(acc.schoolValues);
    result.push({
      nodeId,
      nodeName: acc.nodeName,
      achievement: pctOfTally(acc.tally),
      studentCount: acc.students,
      schoolCount: acc.schools,
      p10: percentileOf(sorted, 10),
      p25: percentileOf(sorted, 25),
    });
  }
  return result.sort((a, b) => a.nodeName.localeCompare(b.nodeName));
}

/** Agrega las filas de los colegios de una muestra (§5 del diseño). */
export function aggregateSample(rows: readonly SampleSourceRow[]): SampleAggregate {
  const schoolAchievements = sortedAscending(
    rows.map((r) => r.avgAchievement).filter((v): v is number => v !== null),
  );
  let studentCount = 0;
  const tally = emptyTally();
  for (const row of rows) {
    studentCount += row.studentCount;
    addTally(tally, { scoreSum: row.scoreSum, maxSum: row.maxSum });
  }

  return {
    schoolCount: rows.length,
    studentCount,
    avgAchievement: pctOfTally(tally),
    p10: percentileOf(schoolAchievements, 10),
    p25: percentileOf(schoolAchievements, 25),
    median: percentileOf(schoolAchievements, 50),
    p75: percentileOf(schoolAchievements, 75),
    bandCounts: sumBandCounts(rows.map((r) => r.bandCounts)),
    perSkill: aggregateSampleSkills(rows),
  };
}

/** Fila de un colegio para un ítem (lo que aporta `benchmark_item_aggregates`). */
export type ItemSampleSourceRow = {
  orgId: string;
  itemId: string;
  correctCount: number;
  responseCount: number;
  scoreSum: number;
  maxSum: number;
};

export type ItemSampleAggregate = {
  schoolCount: number;
  studentCount: number;
  items: ItemSampleStat[];
};

/**
 * % de logro de la muestra por ítem: Σ puntaje ÷ Σ máximo de todos los colegios, con el crédito
 * parcial incluido (`correctRate` conserva su nombre en el contrato). `studentCount` aproxima a
 * los alumnos con el máximo de respuestas que tuvo cada colegio en algún ítem del instrumento.
 */
export function aggregateItemSample(rows: readonly ItemSampleSourceRow[]): ItemSampleAggregate {
  const byItem = new Map<
    string,
    { tally: AchievementTally; responses: number; orgs: Set<string> }
  >();
  const maxResponsesByOrg = new Map<string, number>();
  for (const row of rows) {
    let acc = byItem.get(row.itemId);
    if (!acc) {
      acc = { tally: emptyTally(), responses: 0, orgs: new Set() };
      byItem.set(row.itemId, acc);
    }
    addTally(acc.tally, { scoreSum: row.scoreSum, maxSum: row.maxSum });
    acc.responses += row.responseCount;
    acc.orgs.add(row.orgId);
    maxResponsesByOrg.set(
      row.orgId,
      Math.max(maxResponsesByOrg.get(row.orgId) ?? 0, row.responseCount),
    );
  }

  let studentCount = 0;
  for (const responses of maxResponsesByOrg.values()) studentCount += responses;

  const items: ItemSampleStat[] = [];
  for (const [itemId, acc] of byItem) {
    items.push({
      itemId,
      correctRate: pctOfTally(acc.tally),
      responseCount: acc.responses,
      schoolCount: acc.orgs.size,
    });
  }
  return { schoolCount: maxResponsesByOrg.size, studentCount, items };
}

/** Fila de un colegio en un ítem para armar la muestra de un conjunto de preguntas. */
export type ItemSetSourceRow = {
  orgId: string;
  itemId: string;
  scoreSum: number;
  maxSum: number;
  responseCount: number;
};

/** Muestra de colegios sobre un conjunto de preguntas (prueba, sección, nodo o pregunta). */
export type ItemSetSample = {
  /** Preguntas del conjunto pedido que quedaron en la comparación (k colegios corregidos). */
  comparedItemIds: string[];
  tally: AchievementTally;
  /** % de la muestra (0..100, 2 decimales) sobre `comparedItemIds`. */
  value: number | null;
  schoolCount: number;
  /** Aproximación: por colegio, el máximo de respuestas en alguna pregunta comparada. */
  studentCount: number;
  /** % de cada colegio sobre `comparedItemIds`, ascendente (para el percentil). */
  schoolValues: number[];
};

/**
 * Muestra de un conjunto de preguntas (docs/diseno-logro-unificado-y-cohorte.md §5.1, D9).
 *
 * `itemIds` debe venir ya acotado a las preguntas que el GRUPO COMPARADO tiene corregidas: así
 * los dos lados miden lo mismo y ninguna evaluación sale de la muestra. De ese conjunto quedan
 * las preguntas que al menos `kMinSchools` colegios tienen corregidas (k por pregunta); cada
 * colegio aporta su tally sobre ellas. Devuelve `null` si la muestra resultante no cumple k
 * colegios y `nMinStudents` alumnos.
 */
/** Agrupa las filas por pregunta una sola vez, para pedir muchos conjuntos sin re-escanear. */
export function indexItemSetRows(
  rows: readonly ItemSetSourceRow[],
): Map<string, ItemSetSourceRow[]> {
  const byItem = new Map<string, ItemSetSourceRow[]>();
  for (const row of rows) {
    const list = byItem.get(row.itemId);
    if (list) list.push(row);
    else byItem.set(row.itemId, [row]);
  }
  return byItem;
}

export function aggregateItemSetSample(
  rowsByItem: ReadonlyMap<string, readonly ItemSetSourceRow[]>,
  itemIds: readonly string[],
  kMinSchools: number,
  nMinStudents: number,
): ItemSetSample | null {
  const compared = new Set<string>();
  for (const itemId of new Set(itemIds)) {
    const schools = new Set<string>();
    for (const row of rowsByItem.get(itemId) ?? []) {
      if (row.maxSum > 0) schools.add(row.orgId);
    }
    if (schools.size >= kMinSchools) compared.add(itemId);
  }
  if (compared.size === 0) return null;

  const tally = emptyTally();
  const tallyByOrg = new Map<string, AchievementTally>();
  const maxResponsesByOrg = new Map<string, number>();
  for (const row of [...compared].flatMap((itemId) => rowsByItem.get(itemId) ?? [])) {
    if (!(row.maxSum > 0)) continue;
    const source = { scoreSum: row.scoreSum, maxSum: row.maxSum };
    addTally(tally, source);
    let orgTally = tallyByOrg.get(row.orgId);
    if (!orgTally) {
      orgTally = emptyTally();
      tallyByOrg.set(row.orgId, orgTally);
    }
    addTally(orgTally, source);
    maxResponsesByOrg.set(
      row.orgId,
      Math.max(maxResponsesByOrg.get(row.orgId) ?? 0, row.responseCount),
    );
  }

  let studentCount = 0;
  for (const responses of maxResponsesByOrg.values()) studentCount += responses;
  if (tallyByOrg.size < kMinSchools || studentCount < nMinStudents) return null;

  const schoolValues: number[] = [];
  for (const orgTally of tallyByOrg.values()) {
    const pct = pctOfTally(orgTally);
    if (pct !== null) schoolValues.push(pct);
  }

  return {
    comparedItemIds: itemIds.filter((id) => compared.has(id)),
    tally,
    value: pctOfTally(tally),
    schoolCount: tallyByOrg.size,
    studentCount,
    schoolValues: sortedAscending(schoolValues),
  };
}
