import {
  OFFICIAL_REPORT_PCT_TOLERANCE_PP,
  deriveSkillStatsFromItemStats,
  matchLevelToBand,
  type ItemCohortStats,
  type OfficialReportAxisPreview,
  type OfficialReportGateResult,
  type OfficialReportImportFile,
  type OfficialReportItemPreview,
  type OfficialReportLevelPreview,
  type OfficialReportStudentProposal,
  type PerformanceBandInput,
  type SkillCohortStats,
} from '@soe/types';
import { translateReportToItemStats, type InstrumentItemForImport } from './report-to-item-stats';
import { matchReportName, normalizeName, type StudentForMatch } from './student-name-matcher';

/**
 * Los 5 gates del preview (§6.2). Función PURA: recibe todo lo que hay que consultar
 * en la BD y no toca nada. El preview NO persiste — devuelve el veredicto de cada gate.
 *
 * `confirm` vuelve a correr esto contra la BD del momento en vez de confiar en lo que
 * guardó el preview: entre uno y otro pueden haber cambiado los tags, los ítems o la
 * nómina, y los gates bloqueantes existen justamente para no escribir dato mal leído.
 */

export type GateContext = {
  file: OfficialReportImportFile;
  classGroupId: string;
  itemsByPosition: ReadonlyMap<number, InstrumentItemForImport>;
  /** item_id → node_ids etiquetados (`item_taxonomy_tags`). */
  tagsByItem: ReadonlyMap<string, readonly string[]>;
  /** node_id → nombre, para cotejar el eje reportado (que viene por nombre). */
  nodeNameById: ReadonlyMap<string, string>;
  /** Bandas del instrumento, para resolver el nivel de cada alumno. */
  bands: readonly PerformanceBandInput[];
  /** Nómina del curso (`student_enrollments` del class_group del informe). */
  roster: readonly StudentForMatch[];
};

export type GateEvaluation = {
  gates: OfficialReportGateResult[];
  /** false si algún gate bloqueante falló → el confirm se rechaza. */
  canConfirm: boolean;
  itemStats: ItemCohortStats[];
  skillStats: SkillCohortStats[];
  items: OfficialReportItemPreview[];
  skillAxes: OfficialReportAxisPreview[];
  levelDistribution: OfficialReportLevelPreview[];
  students: OfficialReportStudentProposal[];
  warnings: string[];
};

export function evaluateGates(ctx: GateContext): GateEvaluation {
  const { file, classGroupId } = ctx;
  const warnings: string[] = [];

  const translation = translateReportToItemStats(file, ctx.itemsByPosition, classGroupId);
  const skillStats = deriveSkillStatsFromItemStats(translation.itemStats, ctx.tagsByItem);

  const gates: OfficialReportGateResult[] = [
    countsGate(translation.countMismatchPositions, file.report.studentCount),
    itemsGate(translation.unresolvedPositions),
  ];

  const axes = evaluateAxes(ctx, skillStats);
  gates.push(axesGate(axes, file.skillAxes.length));

  const students = proposeStudents(ctx);
  const levels = evaluateLevels(ctx);
  gates.push(levelsGate(levels, ctx));
  gates.push(studentsGate(students, ctx));

  if (file.students && file.students.length !== file.report.studentCount) {
    warnings.push(
      `El informe declara ${file.report.studentCount} estudiantes pero la figura de niveles trae ${file.students.length}.`,
    );
  }
  const unresolvedLevels = levels.filter((l) => l.performanceBandId === null);
  if (unresolvedLevels.length > 0) {
    warnings.push(
      `Niveles sin banda de logro equivalente en el instrumento: ${unresolvedLevels
        .map((l) => l.level)
        .join(', ')}. Esos estudiantes no se pueden importar.`,
    );
  }

  const items: OfficialReportItemPreview[] = translation.translations.map((t) => ({
    position: t.position,
    itemId: t.itemId,
    studentCount: t.stats?.studentCount ?? file.report.studentCount,
    responseCount: t.stats?.responseCount ?? 0,
    correctCount: t.stats?.correctCount ?? 0,
    scoreSum: t.stats?.scoreSum ?? 0,
    maxSum: t.stats?.maxSum ?? 0,
    answerCounts: t.answerCounts,
    countsSum: t.countsSum,
    countsMatchStudentCount: t.countsMatchStudentCount,
  }));

  const canConfirm = !gates.some((g) => g.blocking && g.status === 'failed');

  return {
    gates,
    canConfirm,
    itemStats: translation.itemStats,
    skillStats,
    items,
    skillAxes: axes,
    levelDistribution: levels,
    students,
    warnings,
  };
}

// ── Gate #1: los conteos reconstruidos suman exactamente N ───────────────────

function countsGate(mismatchPositions: number[], n: number): OfficialReportGateResult {
  if (mismatchPositions.length === 0) {
    return {
      gate: 'counts',
      status: 'passed',
      blocking: true,
      message: `Los conteos reconstruidos suman exactamente ${n} en todas las preguntas.`,
      details: [],
    };
  }
  return {
    gate: 'counts',
    status: 'failed',
    blocking: true,
    // No se reparte la diferencia: que no cuadre significa que el PDF se leyó mal.
    message: `Los conteos de ${mismatchPositions.length} pregunta(s) no suman ${n}. El informe se leyó mal — corrige la extracción antes de importar.`,
    details: mismatchPositions.map((p) => `Pregunta ${p}`),
  };
}

// ── Gate #2: cada posición resuelve a un ítem del instrumento ────────────────

function itemsGate(unresolvedPositions: number[]): OfficialReportGateResult {
  if (unresolvedPositions.length === 0) {
    return {
      gate: 'items',
      status: 'passed',
      blocking: true,
      message: 'Todas las preguntas del informe existen en el instrumento.',
      details: [],
    };
  }
  return {
    gate: 'items',
    status: 'failed',
    blocking: true,
    message: `${unresolvedPositions.length} pregunta(s) del informe no existen en el instrumento seleccionado.`,
    details: unresolvedPositions.map((p) => `Pregunta ${p} sin ítem equivalente`),
  };
}

// ── Gate #3: el eje derivado reproduce el eje reportado ──────────────────────

function evaluateAxes(
  ctx: GateContext,
  skillStats: readonly SkillCohortStats[],
): OfficialReportAxisPreview[] {
  const nodeIdsByName = new Map<string, string[]>();
  for (const [nodeId, name] of ctx.nodeNameById.entries()) {
    const key = normalizeName(name);
    const list = nodeIdsByName.get(key) ?? [];
    list.push(nodeId);
    nodeIdsByName.set(key, list);
  }
  const derivedByNode = new Map(skillStats.map((s) => [s.nodeId, s]));

  return ctx.file.skillAxes.map((axis) => {
    const matches = nodeIdsByName.get(normalizeName(axis.name)) ?? [];
    // Un nombre que resuelve a 2 nodos no es un match: no sabemos cuál validó el
    // informe. Se trata como no resuelto en vez de elegir uno al azar.
    const nodeId = matches.length === 1 ? matches[0]! : null;
    const derived = nodeId ? derivedByNode.get(nodeId) : undefined;
    const derivedPct = derived?.percentage != null ? derived.percentage * 100 : null;
    const deltaPp = derivedPct != null ? Math.abs(derivedPct - axis.pct) : null;
    return {
      name: axis.name,
      nodeId,
      reportedPct: axis.pct,
      derivedPct: derivedPct != null ? round4(derivedPct) : null,
      deltaPp: deltaPp != null ? round4(deltaPp) : null,
      ok: deltaPp != null && deltaPp <= OFFICIAL_REPORT_PCT_TOLERANCE_PP,
    };
  });
}

function axesGate(
  axes: readonly OfficialReportAxisPreview[],
  reportedCount: number,
): OfficialReportGateResult {
  if (reportedCount === 0) {
    // Sin ejes reportados no hay nada contra qué cotejar. No es un fallo del dato,
    // pero sí la pérdida de la mejor barrera de calidad del importador (§2.3).
    return {
      gate: 'skill_axes',
      status: 'warning',
      blocking: false,
      message:
        'El informe no trae % por eje de habilidad: no se pudo validar el etiquetado de taxonomía ni el crédito parcial contra el propio informe.',
      details: [],
    };
  }

  const failed = axes.filter((a) => !a.ok);
  if (failed.length === 0) {
    return {
      gate: 'skill_axes',
      status: 'passed',
      blocking: true,
      message: `Los ${axes.length} eje(s) derivados de los conteos reproducen el informe (tolerancia ${OFFICIAL_REPORT_PCT_TOLERANCE_PP} pp).`,
      details: [],
    };
  }
  return {
    gate: 'skill_axes',
    status: 'failed',
    blocking: true,
    message: `${failed.length} eje(s) no reproducen el informe. Revisa el etiquetado de taxonomía, el puntaje de los ítems y la extracción antes de importar.`,
    details: failed.map((a) => {
      if (a.nodeId === null) {
        return `${a.name}: no hay exactamente un nodo de taxonomía con ese nombre etiquetado en los ítems`;
      }
      if (a.derivedPct === null) {
        return `${a.name}: no se pudo derivar (los ítems del eje no tienen puntaje)`;
      }
      return `${a.name}: derivado ${a.derivedPct.toFixed(2)}% vs informe ${a.reportedPct.toFixed(2)}% (Δ ${a.deltaPp?.toFixed(4)} pp)`;
    }),
  };
}

// ── Gate #4: la distribución de niveles derivada ≈ la reportada ──────────────

// Delega en el helper puro de `@soe/types` (DRY): la misma semántica de matching se
// comparte con el importador y el backfill, que no pueden importar de `apps/api`.
export function resolveLevelBand(
  level: string,
  bands: readonly PerformanceBandInput[],
): PerformanceBandInput | null {
  return matchLevelToBand(level, bands);
}

function evaluateLevels(ctx: GateContext): OfficialReportLevelPreview[] {
  const students = ctx.file.students ?? [];
  const derivedCount = new Map<string, number>();
  for (const s of students) {
    const key = normalizeName(s.level);
    derivedCount.set(key, (derivedCount.get(key) ?? 0) + 1);
  }

  // Se reportan los niveles del informe y además los que solo aparecen en la figura,
  // para que un nivel presente en alumnos pero ausente del gráfico no pase inadvertido.
  const levels = new Map<string, string>();
  for (const l of ctx.file.levelDistribution) levels.set(normalizeName(l.level), l.level);
  for (const s of students) {
    const key = normalizeName(s.level);
    if (!levels.has(key)) levels.set(key, s.level);
  }
  const reportedByKey = new Map(
    ctx.file.levelDistribution.map((l) => [normalizeName(l.level), l.pct]),
  );

  return [...levels.entries()].map(([key, label]) => {
    const band = resolveLevelBand(label, ctx.bands);
    const derivedPct =
      students.length > 0 ? ((derivedCount.get(key) ?? 0) / students.length) * 100 : null;
    const reportedPct = reportedByKey.get(key) ?? 0;
    const deltaPp = derivedPct != null ? Math.abs(derivedPct - reportedPct) : null;
    return {
      level: label,
      reportedPct,
      derivedPct: derivedPct != null ? round4(derivedPct) : null,
      deltaPp: deltaPp != null ? round4(deltaPp) : null,
      performanceBandId: band?.id ?? null,
      bandLabel: band?.label ?? null,
    };
  });
}

function levelsGate(
  levels: readonly OfficialReportLevelPreview[],
  ctx: GateContext,
): OfficialReportGateResult {
  const students = ctx.file.students ?? [];
  if (students.length === 0 || ctx.file.levelDistribution.length === 0) {
    return {
      gate: 'level_distribution',
      status: 'warning',
      blocking: false,
      message:
        'Sin niveles por estudiante o sin distribución reportada: no se pudo cotejar la figura de niveles.',
      details: [],
    };
  }

  const off = levels.filter(
    (l) => l.deltaPp === null || l.deltaPp > OFFICIAL_REPORT_PCT_TOLERANCE_PP,
  );
  if (off.length === 0) {
    return {
      gate: 'level_distribution',
      status: 'passed',
      blocking: false,
      message: 'La distribución de niveles derivada reproduce la del informe.',
      details: [],
    };
  }
  return {
    gate: 'level_distribution',
    // Advertencia, NO rechazo (§6.2 #4): el nivel por alumno sale de OCR sobre un
    // gráfico y una diferencia puede ser un alumno mal leído, no un informe inválido.
    // El humano decide con el detalle a la vista.
    status: 'warning',
    blocking: false,
    message: `${off.length} nivel(es) no cuadran con la distribución del informe. Revisa la lectura de la figura antes de confirmar.`,
    details: off.map(
      (l) =>
        `${l.level}: derivado ${l.derivedPct?.toFixed(2) ?? '—'}% vs informe ${l.reportedPct.toFixed(2)}%`,
    ),
  };
}

// ── Gate #5: match difuso de alumnos (propuesta, nunca decisión) ─────────────

function proposeStudents(ctx: GateContext): OfficialReportStudentProposal[] {
  const students = ctx.file.students ?? [];
  return students.map((s, reportIndex) => {
    const match = matchReportName(s.name, ctx.roster);
    return {
      reportIndex,
      listNumber: s.listNumber ?? null,
      name: s.name,
      level: s.level,
      proposedStudentId: match.studentId,
      proposedStudentName: match.studentName,
      confidence: match.confidence,
      ambiguous: match.ambiguous,
      candidates: match.candidates,
    };
  });
}

function studentsGate(
  proposals: readonly OfficialReportStudentProposal[],
  ctx: GateContext,
): OfficialReportGateResult {
  if ((ctx.file.students ?? []).length === 0) {
    return {
      gate: 'students',
      status: 'passed',
      blocking: false,
      message:
        'El informe no trae niveles por estudiante. Se importarán solo los datos de cohorte.',
      details: [],
    };
  }

  const unmatched = proposals.filter((p) => p.proposedStudentId === null);
  const details = unmatched.map((p) =>
    p.ambiguous
      ? `${p.name}: ${p.candidates.length} candidatos empatados — elige a mano`
      : `${p.name}: sin candidato sobre el umbral (mejor ${(p.confidence * 100).toFixed(0)}%)`,
  );

  // Siempre 'warning', nunca 'passed': el match es una PROPUESTA. Escribir el nivel
  // de un alumno exige que el humano apruebe cada par en el confirm (CLAUDE.md §8.3).
  return {
    gate: 'students',
    status: 'warning',
    blocking: false,
    message:
      unmatched.length === 0
        ? `Los ${proposals.length} estudiantes tienen una propuesta de match. Revísala y confirma: nada se escribe sin tu aprobación.`
        : `${unmatched.length} de ${proposals.length} estudiantes no cruzaron con la nómina del curso. Quedarán fuera si no los asignas a mano.`,
    details,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
