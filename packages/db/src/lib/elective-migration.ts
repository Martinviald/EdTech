/**
 * Lógica pura de la migración "instrumentos por rama → un instrumento con secciones
 * electivas" (`db:migrate:cie-electivas`). No toca la BDD: recibe filas y devuelve planes,
 * para que el emparejamiento y la asignación de formas se prueben sin Postgres.
 *
 * Nada acá sabe de Ciencias: el mapa legacy → fusionado llega como datos
 * (`ElectiveMigrationMap`), generado por `scripts/paes-2026/fusionar_cie_electivas.py`.
 */
import {
  aggregateSkillResults,
  aggregateStudentResults,
  DEFAULT_GRADING_SCALE,
  type ResponseForCalculation,
  type ResponseForItemStats,
  type SkillAggregateResult,
  type StudentAggregateResult,
} from '@soe/types';

export type MapItemEntry = {
  electiveKey: string;
  legacyPrintedNumber: string;
  fusedElectiveKey: string | null;
  fusedPrintedNumber: string;
};

export type MapInstrumentEntry = {
  fused: { sourceJson: string; file: string };
  legacy: { sourceJson: string; electiveKey: string }[];
  items: MapItemEntry[];
};

export type ElectiveMigrationMap = {
  loadKey: string;
  instruments: MapInstrumentEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Mapa inválido: ${path} debe ser un texto no vacío`);
  }
  return value;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Mapa inválido: ${path} debe ser una lista no vacía`);
  }
  return value;
}

/** Valida la forma del archivo de mapa y que cada instrumento declare claves únicas. */
export function parseElectiveMigrationMap(raw: unknown): ElectiveMigrationMap {
  if (!isRecord(raw)) throw new Error('Mapa inválido: se esperaba un objeto');
  const instruments = requireArray(raw.instruments, 'instruments').map((entry, i) => {
    const at = `instruments[${i}]`;
    if (!isRecord(entry) || !isRecord(entry.fused)) throw new Error(`Mapa inválido: ${at}.fused`);
    const fused = {
      sourceJson: requireString(entry.fused.sourceJson, `${at}.fused.sourceJson`),
      file: requireString(entry.fused.file, `${at}.fused.file`),
    };
    const legacy = requireArray(entry.legacy, `${at}.legacy`).map((l, j) => {
      if (!isRecord(l)) throw new Error(`Mapa inválido: ${at}.legacy[${j}]`);
      return {
        sourceJson: requireString(l.sourceJson, `${at}.legacy[${j}].sourceJson`),
        electiveKey: requireString(l.electiveKey, `${at}.legacy[${j}].electiveKey`),
      };
    });
    const keys = new Set(legacy.map((l) => l.electiveKey));
    if (keys.size !== legacy.length) {
      throw new Error(`Mapa inválido: ${at}.legacy repite una electiveKey`);
    }
    const items = requireArray(entry.items, `${at}.items`).map((it, j) => {
      if (!isRecord(it)) throw new Error(`Mapa inválido: ${at}.items[${j}]`);
      const fusedElectiveKey =
        it.fusedElectiveKey === null
          ? null
          : requireString(it.fusedElectiveKey, `${at}.items[${j}].fusedElectiveKey`);
      const electiveKey = requireString(it.electiveKey, `${at}.items[${j}].electiveKey`);
      if (!keys.has(electiveKey)) {
        throw new Error(`Mapa inválido: ${at}.items[${j}] usa la clave ${electiveKey} sin legacy`);
      }
      if (fusedElectiveKey !== null && fusedElectiveKey !== electiveKey) {
        throw new Error(
          `Mapa inválido: ${at}.items[${j}] manda un ítem de ${electiveKey} a la rama ${fusedElectiveKey}`,
        );
      }
      return {
        electiveKey,
        legacyPrintedNumber: String(it.legacyPrintedNumber),
        fusedElectiveKey,
        fusedPrintedNumber: String(it.fusedPrintedNumber),
      };
    });
    return { fused, legacy, items };
  });
  return { loadKey: requireString(raw.loadKey, 'loadKey'), instruments };
}

export type LegacyItemRow = { id: string; electiveKey: string; printedNumber: string };
/** `electiveKey` es la clave de la sección del ítem fusionado; `null` en el tronco común. */
export type FusedItemRow = { id: string; electiveKey: string | null; printedNumber: string };

export type ItemRemap = {
  /** id del ítem legacy → id del ítem fusionado. */
  forward: Map<string, string>;
  /** `${electiveKey}|${idFusionado}` → id del ítem legacy de esa rama. */
  reverse: Map<string, string>;
  errors: string[];
};

export function reverseKey(electiveKey: string, fusedItemId: string): string {
  return `${electiveKey}|${fusedItemId}`;
}

/**
 * Empareja los ítems legacy (por rama y número impreso) con los del instrumento fusionado
 * (por sección y número impreso), según el mapa. Exige que el emparejamiento sea inyectivo
 * dentro de cada rama: es lo que permite deshacerlo sin guardar nada por respuesta.
 */
export function buildItemRemap(
  entries: readonly MapItemEntry[],
  legacyItems: readonly LegacyItemRow[],
  fusedItems: readonly FusedItemRow[],
): ItemRemap {
  const errors: string[] = [];
  const target = new Map<string, MapItemEntry>();
  for (const e of entries) target.set(`${e.electiveKey}|${e.legacyPrintedNumber}`, e);
  const fusedBySlot = new Map<string, string>();
  for (const f of fusedItems) {
    const slot = `${f.electiveKey ?? ''}|${f.printedNumber}`;
    if (fusedBySlot.has(slot)) errors.push(`ítem fusionado repetido en ${slot}`);
    fusedBySlot.set(slot, f.id);
  }
  const forward = new Map<string, string>();
  const reverse = new Map<string, string>();
  for (const legacy of legacyItems) {
    const entry = target.get(`${legacy.electiveKey}|${legacy.printedNumber}`);
    if (!entry) {
      errors.push(
        `ítem legacy ${legacy.electiveKey} #${legacy.printedNumber} sin entrada en el mapa`,
      );
      continue;
    }
    const fusedId = fusedBySlot.get(`${entry.fusedElectiveKey ?? ''}|${entry.fusedPrintedNumber}`);
    if (!fusedId) {
      errors.push(
        `ítem legacy ${legacy.electiveKey} #${legacy.printedNumber}: no existe el destino ` +
          `${entry.fusedElectiveKey ?? 'común'} #${entry.fusedPrintedNumber}`,
      );
      continue;
    }
    const back = reverseKey(legacy.electiveKey, fusedId);
    if (reverse.has(back)) {
      errors.push(
        `dos ítems legacy de ${legacy.electiveKey} van al mismo destino ` +
          `${entry.fusedElectiveKey ?? 'común'} #${entry.fusedPrintedNumber}`,
      );
      continue;
    }
    forward.set(legacy.id, fusedId);
    reverse.set(back, legacy.id);
  }
  return { forward, reverse, errors };
}

export type StudentBranchRow = { studentId: string; electiveKey: string };
export type FormAssignment = {
  byStudent: Map<string, string>;
  conflicts: { studentId: string; electiveKeys: string[] }[];
};

/**
 * Rama de cada alumno dentro de un grupo (evaluación fusionada). Sale de la evaluación legacy
 * donde tiene respuestas; `existing` es lo ya asignado en una corrida anterior. Un alumno con
 * respuestas en dos ramas, o con una rama distinta a la ya asignada, es un conflicto.
 */
export function assignStudentForms(
  rows: readonly StudentBranchRow[],
  existing: ReadonlyMap<string, string> = new Map(),
): FormAssignment {
  const keysByStudent = new Map<string, Set<string>>();
  for (const [studentId, key] of existing) keysByStudent.set(studentId, new Set([key]));
  for (const r of rows) {
    const keys = keysByStudent.get(r.studentId);
    if (keys) keys.add(r.electiveKey);
    else keysByStudent.set(r.studentId, new Set([r.electiveKey]));
  }
  const byStudent = new Map<string, string>();
  const conflicts: FormAssignment['conflicts'] = [];
  for (const [studentId, keys] of keysByStudent) {
    if (keys.size === 1) byStudent.set(studentId, [...keys][0]!);
    else conflicts.push({ studentId, electiveKeys: [...keys].sort() });
  }
  return { byStudent, conflicts };
}

export type LegacyAssessmentRow = {
  id: string;
  instrumentId: string;
  classGroupIds: string[];
};
export type LegacyInstrumentInfo = { fusedSourceJson: string; electiveKey: string };
export type MigrationGroup = {
  key: string;
  fusedSourceJson: string;
  classGroupId: string;
  legacyByKey: Map<string, string>;
};

export function groupKeyOf(fusedSourceJson: string, classGroupId: string): string {
  return `${fusedSourceJson}|${classGroupId}`;
}

/**
 * Agrupa las evaluaciones legacy por (instrumento fusionado, curso): cada grupo será UNA
 * evaluación fusionada. Cada evaluación legacy debe tener exactamente un curso, y un grupo
 * no puede tener dos evaluaciones de la misma rama.
 */
export function groupLegacyAssessments(
  legacy: readonly LegacyAssessmentRow[],
  instrumentInfo: ReadonlyMap<string, LegacyInstrumentInfo>,
): { groups: MigrationGroup[]; errors: string[] } {
  const errors: string[] = [];
  const groups = new Map<string, MigrationGroup>();
  for (const a of legacy) {
    const info = instrumentInfo.get(a.instrumentId);
    if (!info) {
      errors.push(`evaluación ${a.id}: su instrumento no está en el mapa`);
      continue;
    }
    if (a.classGroupIds.length !== 1) {
      errors.push(`evaluación ${a.id}: tiene ${a.classGroupIds.length} cursos (se espera 1)`);
      continue;
    }
    const classGroupId = a.classGroupIds[0]!;
    const key = groupKeyOf(info.fusedSourceJson, classGroupId);
    const group = groups.get(key) ?? {
      key,
      fusedSourceJson: info.fusedSourceJson,
      classGroupId,
      legacyByKey: new Map<string, string>(),
    };
    if (group.legacyByKey.has(info.electiveKey)) {
      errors.push(`curso ${classGroupId}: dos evaluaciones de ${info.electiveKey} en ${key}`);
      continue;
    }
    group.legacyByKey.set(info.electiveKey, a.id);
    groups.set(key, group);
  }
  return { groups: [...groups.values()], errors };
}

export type ScoredResponseRow = ResponseForItemStats & {
  itemPosition: number;
  taxonomyNodeIds: string[];
};

export type ComputedResults = {
  students: StudentAggregateResult[];
  skills: SkillAggregateResult[];
  calc: (ResponseForCalculation & ResponseForItemStats)[];
  studentsWithPending: Set<string>;
};

/**
 * Resultados de una evaluación desde sus respuestas, con la misma semántica que los
 * cargadores de seed (`import-paes-2026-responses.ts`): escala por defecto, los pendientes
 * (`isCorrect === null`) fuera del total del alumno y marcándolo incompleto.
 */
export function computeResultsFromResponses(rows: readonly ScoredResponseRow[]): ComputedResults {
  const calc = rows.map((r) => ({ ...r }));
  const scored = calc.filter((c) => c.isCorrect !== null);
  const studentsWithPending = new Set(
    calc.filter((c) => c.isCorrect === null).map((c) => c.studentId),
  );
  return {
    students: aggregateStudentResults(scored, DEFAULT_GRADING_SCALE),
    skills: aggregateSkillResults(calc, DEFAULT_GRADING_SCALE),
    calc,
    studentsWithPending,
  };
}

export type StudentOutcome = {
  scoreSum: number;
  maxSum: number;
  percentage: string | null;
  grade: string | null;
  isComplete: boolean | null;
};

/** Diferencias de resultado por alumno entre dos fotos (antes/después). */
export function diffStudentOutcomes(
  before: ReadonlyMap<string, StudentOutcome>,
  after: ReadonlyMap<string, StudentOutcome>,
): string[] {
  const diffs: string[] = [];
  for (const [studentId, b] of before) {
    const a = after.get(studentId);
    if (!a) {
      diffs.push(`${studentId}: sin resultado después`);
      continue;
    }
    const same =
      a.scoreSum.toFixed(2) === b.scoreSum.toFixed(2) &&
      a.maxSum.toFixed(2) === b.maxSum.toFixed(2) &&
      a.percentage === b.percentage &&
      a.grade === b.grade &&
      a.isComplete === b.isComplete;
    if (!same) diffs.push(`${studentId}: ${JSON.stringify(b)} → ${JSON.stringify(a)}`);
  }
  for (const studentId of after.keys()) {
    if (!before.has(studentId)) diffs.push(`${studentId}: resultado nuevo sin par previo`);
  }
  return diffs;
}

/**
 * Tags de cada ítem fusionado: la unión de los tags de los ítems legacy que se fusionan en
 * él. Un nodo que una copia marca `primary` y otra `secondary` queda `primary`.
 */
export function unionTagsForFusedItems(
  forward: ReadonlyMap<string, string>,
  legacyTags: readonly { itemId: string; nodeId: string; tagType: 'primary' | 'secondary' }[],
): Map<string, Map<string, 'primary' | 'secondary'>> {
  const out = new Map<string, Map<string, 'primary' | 'secondary'>>();
  for (const t of legacyTags) {
    const fusedId = forward.get(t.itemId);
    if (!fusedId) continue;
    const tags = out.get(fusedId) ?? new Map<string, 'primary' | 'secondary'>();
    if (tags.get(t.nodeId) !== 'primary') tags.set(t.nodeId, t.tagType);
    out.set(fusedId, tags);
  }
  return out;
}
