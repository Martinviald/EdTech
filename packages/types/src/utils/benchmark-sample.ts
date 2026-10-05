import type {
  ItemSampleStat,
  BenchmarkBandCount,
  BenchmarkSkillAggregate,
  SampleSkillStat,
  TypicalZone,
} from '../schemas/benchmark.schema';

/**
 * Cálculos puros de la muestra de benchmarking (docs/diseno-benchmarking-en-contexto.md §5).
 * Sin DB: los usa la API para armar la muestra y las alertas relativas, y se testean solos.
 */

/** Fila de un colegio en la muestra de un instrumento (lo que aporta `benchmark_aggregates`). */
export type SampleSourceRow = {
  studentCount: number;
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

/** Promedio simple; `null` si no hay valores. */
export function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return round2(sum / values.length);
}

/** Promedio ponderado; ignora valores nulos y pesos no positivos. */
export function weightedAverage(
  entries: readonly { value: number | null; weight: number }[],
): number | null {
  let sum = 0;
  let weight = 0;
  for (const entry of entries) {
    if (entry.value === null || entry.weight <= 0) continue;
    sum += entry.value * entry.weight;
    weight += entry.weight;
  }
  return weight === 0 ? null : round2(sum / weight);
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

/** Por nodo: % ponderado por alumnos y p10/p25 sobre el % de cada colegio. */
export function aggregateSampleSkills(rows: readonly SampleSourceRow[]): SampleSkillStat[] {
  const byNode = new Map<
    string,
    {
      nodeName: string;
      weighted: { value: number | null; weight: number }[];
      schoolValues: number[];
      students: number;
      schools: number;
    }
  >();
  for (const row of rows) {
    for (const skill of row.perSkill ?? []) {
      let acc = byNode.get(skill.nodeId);
      if (!acc) {
        acc = { nodeName: skill.nodeName, weighted: [], schoolValues: [], students: 0, schools: 0 };
        byNode.set(skill.nodeId, acc);
      }
      acc.weighted.push({ value: skill.achievement, weight: skill.studentCount });
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
      achievement: weightedAverage(acc.weighted),
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
  for (const row of rows) studentCount += row.studentCount;

  return {
    schoolCount: rows.length,
    studentCount,
    avgAchievement: weightedAverage(
      rows.map((r) => ({ value: r.avgAchievement, weight: r.studentCount })),
    ),
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
};

export type ItemSampleAggregate = {
  schoolCount: number;
  studentCount: number;
  items: ItemSampleStat[];
};

/**
 * % de acierto de la muestra por ítem: suma de aciertos sobre suma de respuestas de
 * todos los colegios. `studentCount` aproxima a los alumnos con el máximo de
 * respuestas que tuvo cada colegio en algún ítem del instrumento.
 */
export function aggregateItemSample(rows: readonly ItemSampleSourceRow[]): ItemSampleAggregate {
  const byItem = new Map<string, { correct: number; responses: number; orgs: Set<string> }>();
  const maxResponsesByOrg = new Map<string, number>();
  for (const row of rows) {
    let acc = byItem.get(row.itemId);
    if (!acc) {
      acc = { correct: 0, responses: 0, orgs: new Set() };
      byItem.set(row.itemId, acc);
    }
    acc.correct += row.correctCount;
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
      correctRate: acc.responses === 0 ? null : round2((acc.correct / acc.responses) * 100),
      responseCount: acc.responses,
      schoolCount: acc.orgs.size,
    });
  }
  return { schoolCount: maxResponsesByOrg.size, studentCount, items };
}
