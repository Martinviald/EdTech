/**
 * Migra evaluaciones cargadas sobre instrumentos "por rama" (un instrumento por mención,
 * con el tronco común duplicado) a UN instrumento con secciones electivas, re-apuntando las
 * respuestas existentes. Dry-run por defecto.
 *
 *   DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:migrate:cie-electivas --org <uuid> [--commit]
 *   ... --rollback [--commit]          deshace lo que hizo la migración
 *   ... --map <ruta> --loadKey <clave>  (el script npm ya pasa el mapa de Ciencias PAES 2026)
 *
 * Nada está atado a Ciencias: el mapa (`scripts/paes-2026/fusionar_cie_electivas.py` lo
 * genera) dice qué instrumento legacy es qué rama y a qué ítem fusionado va cada ítem legacy.
 *
 * Migrar, todo en UNA transacción dentro de `withOrgContext`:
 *  1. importa los instrumentos fusionados que falten (o reactiva los que un rollback dejó
 *     borrados) y verifica que su árbol calce con el JSON;
 *  2. por cada (instrumento fusionado, curso) crea o reusa la evaluación fusionada, sus
 *     formas (una por rama: tronco común + esa rama) y la forma de cada alumno, que es la
 *     rama de la evaluación legacy donde tiene respuestas;
 *  3. re-apunta cada respuesta (evaluación, ítem y forma); no crea ni borra ninguna;
 *  4. copia a los ítems fusionados los tags de sus ítems legacy (los legacy no se tocan);
 *  5. recalcula assessment_results, skill_results y el read-model de cohorte;
 *  6. marca las evaluaciones legacy como `cancelled` (con la fusionada que las reemplaza)
 *     y hace soft delete de los instrumentos legacy;
 *  7. vincula cada fusionada sin proceso al de su tanda (`config.ensayo`), como el cargador
 *     PAES. Las legacy por mención no pudieron vincularse al cargar: tres instrumentos SCI
 *     sin línea para el mismo grado rompen la invariante; la fusionada (`CIE-COMUN`) no.
 * Si algo no calza (alumno en dos ramas, respuesta sin ítem destino, resultado distinto al
 * legacy) aborta sin escribir.
 */
import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { readFileSync } from 'node:fs';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { createDbClient, type Database } from '../client';
import { withOrgContext } from '../with-org-context';
import { recomputeCohortStatsFromResponses, replaceCohortStats } from '../queries/cohort-stats';
import {
  toAssessmentResultRow,
  toSkillResultForCohort,
  toSkillResultRow,
} from '../queries/result-rows';
import {
  formatLoadProcessLinkReport,
  linkLoadedAssessmentsToProcesses,
} from '../queries/process-linking';
import { instruments, instrumentSections } from '../schema/instruments';
import { items, itemTaxonomyTags } from '../schema/items';
import {
  assessmentCourseAssignments,
  assessmentForms,
  assessmentFormStudents,
  assessments,
} from '../schema/assessments';
import { responses } from '../schema/responses';
import { assessmentResults, skillResults } from '../schema/results';
import { instrumentSourceJson } from '../lib/instrument-source';
import { importInstrumentDocuments, type InstrumentJson } from '../seed/import-instruments';
import {
  assignStudentForms,
  buildItemRemap,
  computeResultsFromResponses,
  diffStudentOutcomes,
  groupKeyOf,
  groupLegacyAssessments,
  parseElectiveMigrationMap,
  reverseKey,
  unionTagsForFusedItems,
  type ElectiveMigrationMap,
  type ItemRemap,
  type LegacyInstrumentInfo,
  type MigrationGroup,
  type StudentOutcome,
} from '../lib/elective-migration';

const MIGRATION_CONFIG_KEY = 'electiveMigration';
const CHUNK = 1000;

type Args = {
  mapPath: string;
  orgId: string;
  loadKey: string | null;
  commit: boolean;
  rollback: boolean;
};

type MigrationMarker = {
  sourceLoadKey: string;
  legacyAssessmentIds: Record<string, string>;
};

type LegacyMarker = { supersededBy: string; previousStatus: string };

type SectionLayout = {
  coreIds: string[];
  electives: Map<string, { id: string; name: string }>;
};

type Context = {
  orgId: string;
  loadKey: string;
  map: ElectiveMigrationMap;
  fusedBySource: Map<string, { id: string; name: string }>;
  legacyInfo: Map<string, LegacyInstrumentInfo & { name: string; deletedAt: Date | null }>;
  remapByFused: Map<string, ItemRemap>;
  layoutByFused: Map<string, SectionLayout>;
};

class DryRunAbort extends Error {}

function parseArgs(argv: readonly string[]): Args {
  const value = (name: string): string | null => {
    const inline = argv.find((a) => a.startsWith(`--${name}=`));
    if (inline) return inline.slice(name.length + 3);
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? (argv[index + 1] ?? null) : null;
  };
  const mapPath = value('map');
  const orgId = value('org');
  if (!mapPath) throw new Error('Falta --map <ruta al mapa legacy → fusionado>');
  if (!orgId) throw new Error('Falta --org <uuid de la organización>');
  return {
    mapPath: resolve(mapPath),
    orgId,
    loadKey: value('loadKey'),
    commit: argv.includes('--commit'),
    rollback: argv.includes('--rollback'),
  };
}

function chunks<T>(rows: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function failIf(errors: readonly string[], label: string): void {
  if (errors.length === 0) return;
  const shown = errors.slice(0, 40).map((e) => `  · ${e}`);
  const more = errors.length > 40 ? [`  … y ${errors.length - 40} más`] : [];
  throw new Error(
    [`${label} (${errors.length}); no se escribió nada:`, ...shown, ...more].join('\n'),
  );
}

const printedNumberSql = sql<string>`coalesce(${items.scoringConfig} ->> 'printedNumber', ${items.position}::text)`;

async function loadInstrumentsBySource(tx: Database, sources: readonly string[]) {
  const rows = await tx
    .select({
      id: instruments.id,
      name: instruments.name,
      deletedAt: instruments.deletedAt,
      sourceJson: sql<string>`${instruments.config} ->> 'sourceJson'`,
    })
    .from(instruments)
    .where(inArray(sql`${instruments.config} ->> 'sourceJson'`, [...sources]));
  const bySource = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (bySource.has(row.sourceJson)) {
      throw new Error(`Hay más de un instrumento con sourceJson=${row.sourceJson}`);
    }
    bySource.set(row.sourceJson, row);
  }
  return bySource;
}

async function loadItemsWithSections(tx: Database, instrumentIds: readonly string[]) {
  if (instrumentIds.length === 0) return [];
  return tx
    .select({
      id: items.id,
      instrumentId: items.instrumentId,
      sectionId: items.sectionId,
      printedNumber: printedNumberSql,
      role: instrumentSections.role,
      electiveKey: instrumentSections.electiveKey,
    })
    .from(items)
    .innerJoin(instrumentSections, eq(instrumentSections.id, items.sectionId))
    .where(and(inArray(items.instrumentId, [...instrumentIds]), isNull(items.deletedAt)));
}

function readFusedDocuments(
  map: ElectiveMigrationMap,
  mapPath: string,
): Map<string, InstrumentJson> {
  const docs = new Map<string, InstrumentJson>();
  for (const entry of map.instruments) {
    const doc = JSON.parse(
      readFileSync(resolve(dirname(mapPath), entry.fused.file), 'utf-8'),
    ) as InstrumentJson;
    if (instrumentSourceJson(doc) !== entry.fused.sourceJson) {
      throw new Error(`${entry.fused.file} no declara sourceJson=${entry.fused.sourceJson}`);
    }
    docs.set(entry.fused.sourceJson, doc);
  }
  return docs;
}

async function ensureFusedInstruments(
  tx: Database,
  docs: ReadonlyMap<string, InstrumentJson>,
): Promise<{ imported: number; restored: number }> {
  const sources = [...docs.keys()];
  const existing = await loadInstrumentsBySource(tx, sources);
  const missing = sources.filter((s) => !existing.has(s)).map((s) => docs.get(s)!);
  if (missing.length > 0) await importInstrumentDocuments(tx, missing);
  const after = await loadInstrumentsBySource(tx, sources);
  const notImported = sources.filter((s) => !after.has(s));
  failIf(
    notImported.map((s) => `el importador no creó ${s}`),
    'Instrumentos fusionados',
  );
  const deleted = [...after.values()].filter((r) => r.deletedAt !== null).map((r) => r.id);
  if (deleted.length > 0) {
    await tx.update(instruments).set({ deletedAt: null }).where(inArray(instruments.id, deleted));
  }
  return { imported: missing.length, restored: deleted.length };
}

function verifyFusedTree(
  docs: ReadonlyMap<string, InstrumentJson>,
  fusedBySource: ReadonlyMap<string, { id: string }>,
  fusedItems: Awaited<ReturnType<typeof loadItemsWithSections>>,
): string[] {
  const countByInstrumentSlot = new Map<string, number>();
  for (const item of fusedItems) {
    const slot = `${item.instrumentId}|${item.electiveKey ?? ''}`;
    countByInstrumentSlot.set(slot, (countByInstrumentSlot.get(slot) ?? 0) + 1);
  }
  const errors: string[] = [];
  for (const [source, doc] of docs) {
    const instrumentId = fusedBySource.get(source)!.id;
    const expected = new Map<string, number>();
    for (const s of doc.sections) {
      const slot = `${instrumentId}|${s.role === 'elective' ? (s.electiveKey ?? '') : ''}`;
      expected.set(slot, (expected.get(slot) ?? 0) + s.items.length);
    }
    for (const [slot, n] of expected) {
      const actual = countByInstrumentSlot.get(slot) ?? 0;
      if (actual !== n)
        errors.push(
          `${source}: la sección ${slot.split('|')[1] || 'común'} tiene ${actual} ítems y el JSON ${n}`,
        );
    }
  }
  return errors;
}

async function loadSectionLayouts(tx: Database, instrumentIds: readonly string[]) {
  const rows = await tx
    .select({
      id: instrumentSections.id,
      instrumentId: instrumentSections.instrumentId,
      name: instrumentSections.name,
      role: instrumentSections.role,
      electiveKey: instrumentSections.electiveKey,
    })
    .from(instrumentSections)
    .where(inArray(instrumentSections.instrumentId, [...instrumentIds]));
  const layouts = new Map<string, SectionLayout>();
  for (const row of rows) {
    const layout: SectionLayout = layouts.get(row.instrumentId!) ?? {
      coreIds: [],
      electives: new Map(),
    };
    if (row.role === 'elective' && row.electiveKey) {
      layout.electives.set(row.electiveKey, { id: row.id, name: row.name });
    } else {
      layout.coreIds.push(row.id);
    }
    layouts.set(row.instrumentId!, layout);
  }
  return layouts;
}

async function resolveContext(
  tx: Database,
  args: Args,
  map: ElectiveMigrationMap,
  options: { ensureFused: boolean },
): Promise<Context | null> {
  const loadKey = args.loadKey ?? map.loadKey;
  const docs = readFusedDocuments(map, args.mapPath);
  if (options.ensureFused) {
    const ensured = await ensureFusedInstruments(tx, docs);
    console.log(
      `  instrumentos fusionados: ${ensured.imported} importados · ${ensured.restored} reactivados`,
    );
  }
  const fusedRows = await loadInstrumentsBySource(tx, [...docs.keys()]);
  if (fusedRows.size === 0 && !options.ensureFused) return null;
  const legacyRows = await loadInstrumentsBySource(
    tx,
    map.instruments.flatMap((e) => e.legacy.map((l) => l.sourceJson)),
  );

  const legacyInfo: Context['legacyInfo'] = new Map();
  const missingLegacy: string[] = [];
  for (const entry of map.instruments) {
    for (const l of entry.legacy) {
      const row = legacyRows.get(l.sourceJson);
      if (!row) {
        missingLegacy.push(`no existe el instrumento legacy ${l.sourceJson}`);
        continue;
      }
      legacyInfo.set(row.id, {
        fusedSourceJson: entry.fused.sourceJson,
        electiveKey: l.electiveKey,
        name: row.name,
        deletedAt: row.deletedAt,
      });
    }
  }
  failIf(missingLegacy, 'Instrumentos legacy');

  const fusedBySource = new Map([...fusedRows].map(([s, r]) => [s, { id: r.id, name: r.name }]));
  const fusedIds = [...fusedBySource.values()].map((f) => f.id);
  const fusedItems = await loadItemsWithSections(tx, fusedIds);
  failIf(verifyFusedTree(docs, fusedBySource, fusedItems), 'Árbol de los instrumentos fusionados');
  const legacyItems = await loadItemsWithSections(tx, [...legacyInfo.keys()]);

  const remapByFused = new Map<string, ItemRemap>();
  const remapErrors: string[] = [];
  for (const entry of map.instruments) {
    const fusedId = fusedBySource.get(entry.fused.sourceJson)!.id;
    const remap = buildItemRemap(
      entry.items,
      legacyItems
        .filter((i) => legacyInfo.get(i.instrumentId!)?.fusedSourceJson === entry.fused.sourceJson)
        .map((i) => ({
          id: i.id,
          electiveKey: legacyInfo.get(i.instrumentId!)!.electiveKey,
          printedNumber: i.printedNumber,
        })),
      fusedItems
        .filter((i) => i.instrumentId === fusedId)
        .map((i) => ({
          id: i.id,
          electiveKey: i.role === 'elective' ? i.electiveKey : null,
          printedNumber: i.printedNumber,
        })),
    );
    remapErrors.push(...remap.errors.map((e) => `${entry.fused.sourceJson}: ${e}`));
    remapByFused.set(entry.fused.sourceJson, remap);
  }
  failIf(remapErrors, 'Emparejamiento de ítems');

  return {
    orgId: args.orgId,
    loadKey,
    map,
    fusedBySource,
    legacyInfo,
    remapByFused,
    layoutByFused: await loadSectionLayouts(tx, fusedIds),
  };
}

async function loadOutcomes(
  tx: Database,
  assessmentIds: readonly string[],
): Promise<Map<string, Map<string, StudentOutcome & { completedAt: Date | null }>>> {
  const out = new Map<string, Map<string, StudentOutcome & { completedAt: Date | null }>>();
  if (assessmentIds.length === 0) return out;
  const sums = await tx
    .select({
      assessmentId: responses.assessmentId,
      studentId: responses.studentId,
      scoreSum: sql<string>`coalesce(sum(coalesce(${responses.finalScore}, ${responses.rawScore}, 0)) filter (where ${responses.isCorrect} is not null), 0)`,
      maxSum: sql<string>`coalesce(sum(${responses.maxScore}) filter (where ${responses.isCorrect} is not null), 0)`,
    })
    .from(responses)
    .where(inArray(responses.assessmentId, [...assessmentIds]))
    .groupBy(responses.assessmentId, responses.studentId);
  const results = await tx
    .select({
      assessmentId: assessmentResults.assessmentId,
      studentId: assessmentResults.studentId,
      percentage: assessmentResults.percentage,
      grade: assessmentResults.grade,
      isComplete: assessmentResults.isComplete,
      completedAt: assessmentResults.completedAt,
    })
    .from(assessmentResults)
    .where(inArray(assessmentResults.assessmentId, [...assessmentIds]));
  const resultByKey = new Map(results.map((r) => [`${r.assessmentId}|${r.studentId}`, r]));
  for (const s of sums) {
    const result = resultByKey.get(`${s.assessmentId}|${s.studentId}`);
    const byStudent = out.get(s.assessmentId) ?? new Map();
    byStudent.set(s.studentId, {
      scoreSum: Number(s.scoreSum),
      maxSum: Number(s.maxSum),
      percentage: result?.percentage ?? null,
      grade: result?.grade ?? null,
      isComplete: result?.isComplete ?? null,
      completedAt: result?.completedAt ?? null,
    });
    out.set(s.assessmentId, byStudent);
  }
  return out;
}

async function recomputeAssessment(
  tx: Database,
  assessmentId: string,
  completedAtByStudent: ReadonlyMap<string, Date | null>,
): Promise<void> {
  const rows = await tx
    .select({
      studentId: responses.studentId,
      itemId: responses.itemId,
      value: responses.value,
      isCorrect: responses.isCorrect,
      rawScore: responses.rawScore,
      finalScore: responses.finalScore,
      maxScore: responses.maxScore,
      itemContent: items.content,
      itemPosition: items.position,
    })
    .from(responses)
    .innerJoin(items, eq(items.id, responses.itemId))
    .where(eq(responses.assessmentId, assessmentId));
  const itemIds = [...new Set(rows.map((r) => r.itemId))];
  const tagRows = itemIds.length
    ? await tx
        .select({ itemId: itemTaxonomyTags.itemId, nodeId: itemTaxonomyTags.nodeId })
        .from(itemTaxonomyTags)
        .where(inArray(itemTaxonomyTags.itemId, itemIds))
    : [];
  const tagsByItem = new Map<string, string[]>();
  for (const t of tagRows) {
    const list = tagsByItem.get(t.itemId);
    if (list) list.push(t.nodeId);
    else tagsByItem.set(t.itemId, [t.nodeId]);
  }
  const computed = computeResultsFromResponses(
    rows.map((r) => {
      const alternatives = (r.itemContent as { alternatives?: unknown } | null)?.alternatives;
      return {
        studentId: r.studentId,
        itemId: r.itemId,
        value: r.value as Record<string, unknown> | null,
        hasAlternatives: Array.isArray(alternatives) && alternatives.length > 0,
        isCorrect: r.isCorrect,
        rawScore: r.rawScore === null ? null : Number(r.rawScore),
        finalScore: r.finalScore === null ? null : Number(r.finalScore),
        maxScore: Number(r.maxScore),
        itemPosition: r.itemPosition,
        taxonomyNodeIds: tagsByItem.get(r.itemId) ?? [],
      };
    }),
  );

  await tx.delete(assessmentResults).where(eq(assessmentResults.assessmentId, assessmentId));
  await tx.delete(skillResults).where(eq(skillResults.assessmentId, assessmentId));
  const resultValues = computed.students.map((a) =>
    toAssessmentResultRow(
      assessmentId,
      { ...a, isComplete: a.isComplete && !computed.studentsWithPending.has(a.studentId) },
      completedAtByStudent.get(a.studentId) ?? null,
    ),
  );
  for (const c of chunks(resultValues)) await tx.insert(assessmentResults).values(c);
  const skillValues = computed.skills.map((a) => toSkillResultRow(assessmentId, a));
  for (const c of chunks(skillValues)) await tx.insert(skillResults).values(c);
  await recomputeCohortStatsFromResponses(tx, {
    assessmentId,
    responses: computed.calc,
    skillResults: computed.skills.map(toSkillResultForCohort),
  });
}

async function clearDerived(tx: Database, assessmentId: string): Promise<void> {
  await tx.delete(assessmentResults).where(eq(assessmentResults.assessmentId, assessmentId));
  await tx.delete(skillResults).where(eq(skillResults.assessmentId, assessmentId));
  await replaceCohortStats(tx, assessmentId, 'computed', [], []);
}

async function repointResponses(
  tx: Database,
  rows: readonly { id: string; assessmentId: string; itemId: string; formId: string | null }[],
): Promise<void> {
  for (const c of chunks(rows)) {
    const values = sql.join(
      c.map(
        (r) => sql`(${r.id}::uuid, ${r.assessmentId}::uuid, ${r.itemId}::uuid, ${r.formId}::uuid)`,
      ),
      sql`, `,
    );
    await tx.execute(sql`
      update responses as r
         set assessment_id = v.assessment_id, item_id = v.item_id, form_id = v.form_id, updated_at = now()
        from (values ${values}) as v(id, assessment_id, item_id, form_id)
       where r.id = v.id`);
  }
}

async function loadCourseAssignments(tx: Database, assessmentIds: readonly string[]) {
  const byAssessment = new Map<string, string[]>();
  if (assessmentIds.length === 0) return byAssessment;
  const rows = await tx
    .select({
      assessmentId: assessmentCourseAssignments.assessmentId,
      classGroupId: assessmentCourseAssignments.classGroupId,
    })
    .from(assessmentCourseAssignments)
    .where(inArray(assessmentCourseAssignments.assessmentId, [...assessmentIds]));
  for (const r of rows) {
    const list = byAssessment.get(r.assessmentId);
    if (list) list.push(r.classGroupId);
    else byAssessment.set(r.assessmentId, [r.classGroupId]);
  }
  return byAssessment;
}

async function loadMigratedAssessments(tx: Database, ctx: Context) {
  const fusedIds = [...ctx.fusedBySource.values()].map((f) => f.id);
  const rows = await tx
    .select({
      id: assessments.id,
      instrumentId: assessments.instrumentId,
      config: assessments.config,
    })
    .from(assessments)
    .where(
      and(
        eq(assessments.orgId, ctx.orgId),
        inArray(assessments.instrumentId, fusedIds),
        sql`${assessments.config} -> ${MIGRATION_CONFIG_KEY} ->> 'sourceLoadKey' = ${ctx.loadKey}`,
      ),
    );
  const courses = await loadCourseAssignments(
    tx,
    rows.map((r) => r.id),
  );
  const sourceById = new Map([...ctx.fusedBySource].map(([s, f]) => [f.id, s]));
  return rows.map((r) => ({
    id: r.id,
    instrumentId: r.instrumentId,
    fusedSourceJson: sourceById.get(r.instrumentId)!,
    classGroupIds: courses.get(r.id) ?? [],
    marker: (r.config?.[MIGRATION_CONFIG_KEY] ?? null) as MigrationMarker | null,
    config: r.config ?? {},
  }));
}

async function loadFormKeys(tx: Database, ctx: Context, assessmentIds: readonly string[]) {
  const keyBySection = new Map<string, string>();
  for (const layout of ctx.layoutByFused.values()) {
    for (const [key, section] of layout.electives) keyBySection.set(section.id, key);
  }
  const forms = assessmentIds.length
    ? await tx
        .select({
          id: assessmentForms.id,
          assessmentId: assessmentForms.assessmentId,
          sectionIds: assessmentForms.sectionIds,
        })
        .from(assessmentForms)
        .where(inArray(assessmentForms.assessmentId, [...assessmentIds]))
    : [];
  const keyByForm = new Map<string, string>();
  const formByAssessmentKey = new Map<string, string>();
  for (const f of forms) {
    const keys = (f.sectionIds ?? [])
      .map((id) => keyBySection.get(id))
      .filter((k): k is string => !!k);
    if (keys.length !== 1) continue;
    keyByForm.set(f.id, keys[0]!);
    formByAssessmentKey.set(`${f.assessmentId}|${keys[0]}`, f.id);
  }
  const students = forms.length
    ? await tx
        .select({
          formId: assessmentFormStudents.assessmentFormId,
          studentId: assessmentFormStudents.studentId,
        })
        .from(assessmentFormStudents)
        .where(
          inArray(
            assessmentFormStudents.assessmentFormId,
            forms.map((f) => f.id),
          ),
        )
    : [];
  const assessmentByForm = new Map(forms.map((f) => [f.id, f.assessmentId]));
  const keyByAssessmentStudent = new Map<string, string>();
  for (const s of students) {
    const key = keyByForm.get(s.formId);
    if (key) keyByAssessmentStudent.set(`${assessmentByForm.get(s.formId)}|${s.studentId}`, key);
  }
  return { formByAssessmentKey, keyByAssessmentStudent };
}

function remapOutcomeKeys(
  outcomes: Map<string, Map<string, StudentOutcome & { completedAt: Date | null }>>,
  groupOf: (assessmentId: string) => string,
): Map<string, StudentOutcome & { completedAt: Date | null }> {
  const out = new Map<string, StudentOutcome & { completedAt: Date | null }>();
  for (const [assessmentId, byStudent] of outcomes) {
    for (const [studentId, o] of byStudent) out.set(`${groupOf(assessmentId)}|${studentId}`, o);
  }
  return out;
}

function stripCompletedAt(m: Map<string, StudentOutcome & { completedAt: Date | null }>) {
  return new Map(
    [...m].map(([k, { completedAt: _completedAt, ...o }]) => [k, o as StudentOutcome]),
  );
}

async function countResponses(tx: Database, assessmentIds: readonly string[]): Promise<number> {
  if (assessmentIds.length === 0) return 0;
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(responses)
    .where(inArray(responses.assessmentId, [...assessmentIds]));
  return Number(row?.n ?? 0);
}

async function syncFusedTags(tx: Database, ctx: Context): Promise<{ items: number; tags: number }> {
  const legacyIds = [...ctx.legacyInfo.keys()];
  const forward = new Map<string, string>();
  for (const remap of ctx.remapByFused.values())
    for (const [l, f] of remap.forward) forward.set(l, f);
  const legacyTags = await tx
    .select({
      itemId: itemTaxonomyTags.itemId,
      nodeId: itemTaxonomyTags.nodeId,
      tagType: itemTaxonomyTags.tagType,
    })
    .from(itemTaxonomyTags)
    .innerJoin(items, eq(items.id, itemTaxonomyTags.itemId))
    .where(inArray(items.instrumentId, legacyIds));
  const desired = unionTagsForFusedItems(forward, legacyTags);
  const fusedItemIds = [...new Set(forward.values())];
  const current = fusedItemIds.length
    ? await tx
        .select({
          itemId: itemTaxonomyTags.itemId,
          nodeId: itemTaxonomyTags.nodeId,
          tagType: itemTaxonomyTags.tagType,
        })
        .from(itemTaxonomyTags)
        .where(inArray(itemTaxonomyTags.itemId, fusedItemIds))
    : [];
  const currentByItem = new Map<string, Map<string, string>>();
  for (const t of current) {
    const tags = currentByItem.get(t.itemId) ?? new Map<string, string>();
    tags.set(t.nodeId, t.tagType);
    currentByItem.set(t.itemId, tags);
  }
  const changed = fusedItemIds.filter((id) => {
    const want = desired.get(id) ?? new Map();
    const have = currentByItem.get(id) ?? new Map();
    return want.size !== have.size || [...want].some(([node, type]) => have.get(node) !== type);
  });
  if (changed.length === 0) return { items: 0, tags: 0 };
  for (const c of chunks(changed))
    await tx.delete(itemTaxonomyTags).where(inArray(itemTaxonomyTags.itemId, c));
  const values = changed.flatMap((itemId) =>
    [...(desired.get(itemId) ?? new Map<string, 'primary' | 'secondary'>())].map(
      ([nodeId, tagType]) => ({
        itemId,
        nodeId,
        tagType,
        taggedBy: 'human' as const,
        confidence: '1.00',
      }),
    ),
  );
  for (const c of chunks(values)) await tx.insert(itemTaxonomyTags).values(c);
  return { items: changed.length, tags: values.length };
}

async function migrate(tx: Database, args: Args, map: ElectiveMigrationMap): Promise<void> {
  const ctx = (await resolveContext(tx, args, map, { ensureFused: true }))!;
  const legacyIds = [...ctx.legacyInfo.keys()];
  const legacyAssessments = await tx
    .select({
      id: assessments.id,
      instrumentId: assessments.instrumentId,
      name: assessments.name,
      status: assessments.status,
      mode: assessments.mode,
      dataGranularity: assessments.dataGranularity,
      administeredAt: assessments.administeredAt,
      processId: assessments.processId,
      config: assessments.config,
    })
    .from(assessments)
    .where(
      and(
        eq(assessments.orgId, ctx.orgId),
        inArray(assessments.instrumentId, legacyIds),
        sql`${assessments.config} ->> 'loadKey' = ${ctx.loadKey}`,
      ),
    );
  const legacyById = new Map(legacyAssessments.map((a) => [a.id, a]));
  const legacyCourses = await loadCourseAssignments(
    tx,
    legacyAssessments.map((a) => a.id),
  );
  const grouping = groupLegacyAssessments(
    legacyAssessments.map((a) => ({
      id: a.id,
      instrumentId: a.instrumentId,
      classGroupIds: legacyCourses.get(a.id) ?? [],
    })),
    ctx.legacyInfo,
  );
  failIf(grouping.errors, 'Evaluaciones legacy');

  const migrated = await loadMigratedAssessments(tx, ctx);
  const fusedByGroup = new Map<string, (typeof migrated)[number]>();
  for (const m of migrated) {
    if (m.classGroupIds.length !== 1) continue;
    fusedByGroup.set(groupKeyOf(m.fusedSourceJson, m.classGroupIds[0]!), m);
  }
  const groupByLegacy = new Map<string, MigrationGroup>();
  for (const g of grouping.groups)
    for (const id of g.legacyByKey.values()) groupByLegacy.set(id, g);

  const legacyResponses = legacyAssessments.length
    ? await tx
        .select({
          id: responses.id,
          assessmentId: responses.assessmentId,
          studentId: responses.studentId,
          itemId: responses.itemId,
          formId: responses.formId,
        })
        .from(responses)
        .where(
          inArray(
            responses.assessmentId,
            legacyAssessments.map((a) => a.id),
          ),
        )
    : [];
  const fusedIdsBefore = [...fusedByGroup.values()].map((m) => m.id);
  const formsBefore = await loadFormKeys(tx, ctx, fusedIdsBefore);
  const fusedResponseKeys = new Set(
    fusedIdsBefore.length
      ? (
          await tx
            .select({ a: responses.assessmentId, s: responses.studentId, i: responses.itemId })
            .from(responses)
            .where(inArray(responses.assessmentId, fusedIdsBefore))
        ).map((r) => `${r.a}|${r.s}|${r.i}`)
      : [],
  );
  const totalBefore = legacyResponses.length + fusedResponseKeys.size;

  const errors: string[] = [];
  const assignmentByGroup = new Map<string, Map<string, string>>();
  for (const g of grouping.groups) {
    const existing = new Map<string, string>();
    const fused = fusedByGroup.get(g.key);
    if (fused) {
      for (const [k, key] of formsBefore.keyByAssessmentStudent) {
        const [assessmentId, studentId] = k.split('|');
        if (assessmentId === fused.id) existing.set(studentId!, key);
      }
    }
    const keyByLegacy = new Map([...g.legacyByKey].map(([key, id]) => [id, key]));
    const rows = legacyResponses
      .filter((r) => keyByLegacy.has(r.assessmentId))
      .map((r) => ({ studentId: r.studentId, electiveKey: keyByLegacy.get(r.assessmentId)! }));
    const assignment = assignStudentForms(rows, existing);
    for (const c of assignment.conflicts) {
      errors.push(`${g.key}: el alumno ${c.studentId} aparece en ${c.electiveKeys.join(' y ')}`);
    }
    assignmentByGroup.set(g.key, assignment.byStudent);
    const processIds = new Set(
      [...g.legacyByKey.values()].map((id) => legacyById.get(id)!.processId).filter((p) => p),
    );
    if (processIds.size > 1)
      errors.push(`${g.key}: las evaluaciones legacy están en procesos distintos`);
  }
  const plannedKeys = new Set<string>();
  for (const r of legacyResponses) {
    const g = groupByLegacy.get(r.assessmentId)!;
    const fusedItem = ctx.remapByFused.get(g.fusedSourceJson)!.forward.get(r.itemId);
    if (!fusedItem)
      errors.push(`respuesta ${r.id}: su ítem no tiene destino en el instrumento fusionado`);
    if (r.formId !== null) errors.push(`respuesta ${r.id}: ya tiene forma ${r.formId}`);
    const slot = `${g.key}|${r.studentId}|${fusedItem}`;
    if (plannedKeys.has(slot))
      errors.push(`dos respuestas del alumno ${r.studentId} van al mismo ítem en ${g.key}`);
    plannedKeys.add(slot);
    const existingFused = fusedByGroup.get(g.key);
    if (existingFused && fusedResponseKeys.has(`${existingFused.id}|${r.studentId}|${fusedItem}`)) {
      errors.push(`respuesta ${r.id}: el alumno ya tiene respuesta en el ítem fusionado`);
    }
  }
  failIf(errors, 'Validación');

  const legacyWithResponses = [...new Set(legacyResponses.map((r) => r.assessmentId))];
  const before = remapOutcomeKeys(
    await loadOutcomes(tx, legacyWithResponses),
    (id) => groupByLegacy.get(id)!.key,
  );

  const tagSync = await syncFusedTags(tx, ctx);
  let createdAssessments = 0;
  let createdForms = 0;
  let createdFormStudents = 0;
  const fusedIdByGroup = new Map<string, string>();
  const formIdByGroupKey = new Map<string, string>();
  for (const g of grouping.groups) {
    const fused = ctx.fusedBySource.get(g.fusedSourceJson)!;
    const legacyRows = [...g.legacyByKey.values()].map((id) => legacyById.get(id)!);
    const legacyIdsByKey = Object.fromEntries(g.legacyByKey);
    let fusedAssessmentId = fusedByGroup.get(g.key)?.id;
    if (!fusedAssessmentId) {
      const first = legacyRows[0]!;
      const instrumentName = ctx.legacyInfo.get(first.instrumentId)!.name;
      const suffix = first.name?.startsWith(instrumentName)
        ? first.name.slice(instrumentName.length)
        : '';
      const administered = legacyRows
        .map((a) => a.administeredAt)
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      const [inserted] = await tx
        .insert(assessments)
        .values({
          orgId: ctx.orgId,
          instrumentId: fused.id,
          processId: legacyRows.map((a) => a.processId).find((p) => p) ?? null,
          name: `${fused.name}${suffix}`,
          mode: first.mode,
          status: 'completed',
          dataGranularity: first.dataGranularity,
          administeredAt: administered ?? null,
          config: {
            source: 'elective-migration',
            ensayo: first.config?.ensayo ?? null,
            subject: first.config?.subject ?? null,
            loadKey: `${ctx.loadKey}-electivas`,
            classGroupId: g.classGroupId,
            [MIGRATION_CONFIG_KEY]: {
              sourceLoadKey: ctx.loadKey,
              legacyAssessmentIds: legacyIdsByKey,
            },
          },
        })
        .returning({ id: assessments.id });
      fusedAssessmentId = inserted!.id;
      createdAssessments++;
    } else {
      const current = fusedByGroup.get(g.key)!;
      const merged = { ...(current.marker?.legacyAssessmentIds ?? {}), ...legacyIdsByKey };
      if (JSON.stringify(merged) !== JSON.stringify(current.marker?.legacyAssessmentIds ?? {})) {
        await tx
          .update(assessments)
          .set({
            config: {
              ...current.config,
              [MIGRATION_CONFIG_KEY]: { sourceLoadKey: ctx.loadKey, legacyAssessmentIds: merged },
            },
          })
          .where(eq(assessments.id, current.id));
      }
    }
    fusedIdByGroup.set(g.key, fusedAssessmentId);
    await tx
      .insert(assessmentCourseAssignments)
      .values({ assessmentId: fusedAssessmentId, classGroupId: g.classGroupId })
      .onConflictDoNothing();

    const layout = ctx.layoutByFused.get(fused.id)!;
    for (const [key, section] of layout.electives) {
      const existingForm = formsBefore.formByAssessmentKey.get(`${fusedAssessmentId}|${key}`);
      if (existingForm) {
        formIdByGroupKey.set(`${g.key}|${key}`, existingForm);
        continue;
      }
      const [form] = await tx
        .insert(assessmentForms)
        .values({
          orgId: ctx.orgId,
          assessmentId: fusedAssessmentId,
          name: section.name,
          sectionIds: [...layout.coreIds, section.id],
        })
        .returning({ id: assessmentForms.id });
      formIdByGroupKey.set(`${g.key}|${key}`, form!.id);
      createdForms++;
    }
    const newStudents = [...assignmentByGroup.get(g.key)!]
      .filter(
        ([studentId]) =>
          !formsBefore.keyByAssessmentStudent.has(`${fusedAssessmentId}|${studentId}`),
      )
      .map(([studentId, key]) => ({
        orgId: ctx.orgId,
        assessmentFormId: formIdByGroupKey.get(`${g.key}|${key}`)!,
        studentId,
      }));
    for (const c of chunks(newStudents)) {
      await tx.insert(assessmentFormStudents).values(c).onConflictDoNothing();
    }
    createdFormStudents += newStudents.length;
  }

  await repointResponses(
    tx,
    legacyResponses.map((r) => {
      const g = groupByLegacy.get(r.assessmentId)!;
      const key = assignmentByGroup.get(g.key)!.get(r.studentId)!;
      return {
        id: r.id,
        assessmentId: fusedIdByGroup.get(g.key)!,
        itemId: ctx.remapByFused.get(g.fusedSourceJson)!.forward.get(r.itemId)!,
        formId: formIdByGroupKey.get(`${g.key}|${key}`)!,
      };
    }),
  );

  const completedAt = new Map<string, Map<string, Date | null>>();
  for (const [k, o] of before) {
    const cut = k.lastIndexOf('|');
    const byStudent = completedAt.get(k.slice(0, cut)) ?? new Map<string, Date | null>();
    byStudent.set(k.slice(cut + 1), o.completedAt);
    completedAt.set(k.slice(0, cut), byStudent);
  }
  const touchedGroups = new Set(legacyWithResponses.map((id) => groupByLegacy.get(id)!.key));
  const recomputeAll = tagSync.items > 0;
  let recomputed = 0;
  for (const g of grouping.groups) {
    if (!recomputeAll && !touchedGroups.has(g.key)) continue;
    const fusedAssessmentId = fusedIdByGroup.get(g.key)!;
    const previous =
      (await loadOutcomes(tx, [fusedAssessmentId])).get(fusedAssessmentId) ?? new Map();
    const dates = new Map([...previous].map(([s, o]) => [s, o.completedAt]));
    for (const [s, d] of completedAt.get(g.key) ?? new Map()) dates.set(s, d);
    await recomputeAssessment(tx, fusedAssessmentId, dates);
    recomputed++;
  }
  for (const id of legacyWithResponses) await clearDerived(tx, id);

  let cancelled = 0;
  for (const a of legacyAssessments) {
    if (a.config?.[MIGRATION_CONFIG_KEY]) continue;
    const marker: LegacyMarker = {
      supersededBy: fusedIdByGroup.get(groupByLegacy.get(a.id)!.key)!,
      previousStatus: a.status,
    };
    await tx
      .update(assessments)
      .set({ status: 'cancelled', config: { ...(a.config ?? {}), [MIGRATION_CONFIG_KEY]: marker } })
      .where(eq(assessments.id, a.id));
    cancelled++;
  }
  const softDeleted = await tx
    .update(instruments)
    .set({ deletedAt: new Date() })
    .where(and(inArray(instruments.id, legacyIds), isNull(instruments.deletedAt)))
    .returning({ id: instruments.id });

  const fusedIds = [...fusedIdByGroup.values()];
  const after = remapOutcomeKeys(await loadOutcomes(tx, fusedIds), (id) => {
    for (const [gk, fid] of fusedIdByGroup) if (fid === id) return gk;
    return id;
  });
  const beforeKeys = new Set(before.keys());
  const afterForBefore = new Map([...after].filter(([k]) => beforeKeys.has(k)));
  const gateErrors = diffStudentOutcomes(
    stripCompletedAt(before),
    stripCompletedAt(afterForBefore),
  );
  const remainingLegacy = await countResponses(
    tx,
    legacyAssessments.map((a) => a.id),
  );
  if (remainingLegacy > 0)
    gateErrors.push(`quedan ${remainingLegacy} respuestas en evaluaciones legacy`);
  const totalAfter = await countResponses(tx, fusedIds);
  if (totalAfter !== totalBefore)
    gateErrors.push(`respuestas antes=${totalBefore} después=${totalAfter}`);
  const formsAfter = await loadFormKeys(tx, ctx, fusedIds);
  const withoutForm = fusedIds.length
    ? await tx
        .selectDistinct({ a: responses.assessmentId, s: responses.studentId })
        .from(responses)
        .where(inArray(responses.assessmentId, fusedIds))
    : [];
  const missingForm = withoutForm.filter(
    (r) => !formsAfter.keyByAssessmentStudent.has(`${r.a}|${r.s}`),
  );
  if (missingForm.length)
    gateErrors.push(`${missingForm.length} alumnos con respuestas y sin forma`);
  if (fusedIds.length) {
    const [withoutFormId] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(responses)
      .where(and(inArray(responses.assessmentId, fusedIds), isNull(responses.formId)));
    if (Number(withoutFormId?.n ?? 0) > 0)
      gateErrors.push(`${withoutFormId!.n} respuestas sin forma`);
  }
  failIf(gateErrors, 'Gate posterior');

  const processLinks = await linkLoadedAssessmentsToProcesses(tx, {
    orgId: ctx.orgId,
    assessmentIds: fusedIds,
    source: { by: 'config', key: 'ensayo' },
  });

  console.log(
    `  evaluaciones legacy: ${legacyAssessments.length} (${legacyWithResponses.length} con respuestas) · ` +
      `grupos: ${grouping.groups.length}`,
  );
  console.log(
    `  evaluaciones fusionadas creadas: ${createdAssessments} · formas: ${createdForms} · ` +
      `alumnos asignados: ${createdFormStudents}`,
  );
  console.log(
    `  respuestas re-apuntadas: ${legacyResponses.length} (total en fusionadas: ${totalAfter})`,
  );
  console.log(`  tags sincronizados: ${tagSync.tags} en ${tagSync.items} ítems fusionados`);
  console.log(
    `  evaluaciones recalculadas: ${recomputed} · legacy marcadas: ${cancelled} · ` +
      `instrumentos legacy con soft delete: ${softDeleted.length}`,
  );
  console.log(
    `  gate: ${before.size} alumnos con el mismo % de logro, nota y completitud que el legacy`,
  );
  for (const line of formatLoadProcessLinkReport(processLinks)) console.log(line);
}

async function rollback(tx: Database, args: Args, map: ElectiveMigrationMap): Promise<void> {
  const ctx = await resolveContext(tx, args, map, { ensureFused: false });
  if (!ctx) {
    console.log('  no hay instrumentos fusionados: nada que deshacer');
    return;
  }
  const migrated = await loadMigratedAssessments(tx, ctx);
  const fusedIds = migrated.map((m) => m.id);
  const legacyTargetIds = [
    ...new Set(migrated.flatMap((m) => Object.values(m.marker?.legacyAssessmentIds ?? {}))),
  ];
  const legacyRows = legacyTargetIds.length
    ? await tx
        .select({ id: assessments.id, config: assessments.config })
        .from(assessments)
        .where(and(eq(assessments.orgId, ctx.orgId), inArray(assessments.id, legacyTargetIds)))
    : [];
  const legacyById = new Map(legacyRows.map((r) => [r.id, r]));
  const forms = await loadFormKeys(tx, ctx, fusedIds);
  const fusedResponses = fusedIds.length
    ? await tx
        .select({
          id: responses.id,
          assessmentId: responses.assessmentId,
          studentId: responses.studentId,
          itemId: responses.itemId,
        })
        .from(responses)
        .where(inArray(responses.assessmentId, fusedIds))
    : [];
  const migratedById = new Map(migrated.map((m) => [m.id, m]));

  const errors: string[] = [];
  for (const id of legacyTargetIds)
    if (!legacyById.has(id)) errors.push(`no existe la evaluación legacy ${id}`);
  const plan: { id: string; assessmentId: string; itemId: string; formId: null }[] = [];
  const legacyOf = new Map<string, string>();
  for (const r of fusedResponses) {
    const m = migratedById.get(r.assessmentId)!;
    const key = forms.keyByAssessmentStudent.get(`${r.assessmentId}|${r.studentId}`);
    const legacyAssessmentId = key ? m.marker?.legacyAssessmentIds[key] : undefined;
    const legacyItemId = key
      ? ctx.remapByFused.get(m.fusedSourceJson)!.reverse.get(reverseKey(key, r.itemId))
      : undefined;
    if (!key || !legacyAssessmentId || !legacyItemId) {
      errors.push(`respuesta ${r.id}: no se puede volver a su evaluación o ítem legacy`);
      continue;
    }
    plan.push({ id: r.id, assessmentId: legacyAssessmentId, itemId: legacyItemId, formId: null });
    legacyOf.set(`${r.assessmentId}|${r.studentId}`, legacyAssessmentId);
  }
  failIf(errors, 'Validación del rollback');

  const fusedOutcomes = await loadOutcomes(tx, fusedIds);
  const before = new Map<string, StudentOutcome & { completedAt: Date | null }>();
  const completedByLegacy = new Map<string, Map<string, Date | null>>();
  for (const [assessmentId, byStudent] of fusedOutcomes) {
    for (const [studentId, o] of byStudent) {
      const legacyId = legacyOf.get(`${assessmentId}|${studentId}`)!;
      before.set(`${legacyId}|${studentId}`, o);
      const dates = completedByLegacy.get(legacyId) ?? new Map<string, Date | null>();
      dates.set(studentId, o.completedAt);
      completedByLegacy.set(legacyId, dates);
    }
  }

  await repointResponses(tx, plan);
  const remaining = await countResponses(tx, fusedIds);
  if (remaining > 0)
    throw new Error(`quedaron ${remaining} respuestas en las evaluaciones fusionadas`);
  if (fusedIds.length) {
    for (const id of fusedIds) await clearDerived(tx, id);
    await tx.delete(assessmentForms).where(inArray(assessmentForms.assessmentId, fusedIds));
    await tx
      .delete(assessmentCourseAssignments)
      .where(inArray(assessmentCourseAssignments.assessmentId, fusedIds));
    await tx.delete(assessments).where(inArray(assessments.id, fusedIds));
  }
  for (const row of legacyRows) {
    const { [MIGRATION_CONFIG_KEY]: marker, ...rest } = row.config ?? {};
    if (!marker) continue;
    const previousStatus = (marker as LegacyMarker)
      .previousStatus as typeof assessments.$inferInsert.status;
    await tx
      .update(assessments)
      .set({ status: previousStatus, config: rest })
      .where(eq(assessments.id, row.id));
  }
  for (const [legacyId, dates] of completedByLegacy) await recomputeAssessment(tx, legacyId, dates);
  const restored = await tx
    .update(instruments)
    .set({ deletedAt: null })
    .where(
      and(inArray(instruments.id, [...ctx.legacyInfo.keys()]), isNotNull(instruments.deletedAt)),
    )
    .returning({ id: instruments.id });
  const fusedInstrumentIds = [...ctx.fusedBySource.values()].map((f) => f.id);
  const hidden = await tx
    .update(instruments)
    .set({ deletedAt: new Date() })
    .where(and(inArray(instruments.id, fusedInstrumentIds), isNull(instruments.deletedAt)))
    .returning({ id: instruments.id });

  const after = new Map<string, StudentOutcome & { completedAt: Date | null }>();
  for (const [legacyId, byStudent] of await loadOutcomes(tx, [...completedByLegacy.keys()])) {
    for (const [studentId, o] of byStudent) after.set(`${legacyId}|${studentId}`, o);
  }
  failIf(
    diffStudentOutcomes(stripCompletedAt(before), stripCompletedAt(after)),
    'Gate del rollback',
  );

  console.log(
    `  evaluaciones fusionadas eliminadas: ${fusedIds.length} · respuestas devueltas: ${plan.length} · ` +
      `legacy recalculadas: ${completedByLegacy.size}`,
  );
  console.log(
    `  instrumentos legacy reactivados: ${restored.length} · fusionados con soft delete: ${hidden.length}`,
  );
  console.log(
    `  gate: ${before.size} alumnos con el mismo % de logro que en la evaluación fusionada`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  const map = parseElectiveMigrationMap(JSON.parse(readFileSync(args.mapPath, 'utf-8')));
  const mode = args.rollback ? 'rollback' : 'migración';
  console.log(
    `${mode} · org ${args.orgId} · loadKey ${args.loadKey ?? map.loadKey} · ` +
      `${args.commit ? 'COMMIT' : 'dry-run'}`,
  );
  const db = createDbClient(url, { maxConnections: 1 });
  try {
    await withOrgContext(db, args.orgId, async (tx) => {
      if (args.rollback) await rollback(tx, args, map);
      else await migrate(tx, args, map);
      if (!args.commit) throw new DryRunAbort();
    });
    console.log('✅ COMMIT');
  } catch (error) {
    if (!(error instanceof DryRunAbort)) throw error;
    console.log('(dry-run: se revirtió todo. Re-corre con --commit)');
  } finally {
    await db.$client.end();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('ERROR:', error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
