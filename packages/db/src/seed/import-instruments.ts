/**
 * Import idempotente de instrumentos + secciones + ítems desde los JSON con-pauta DIA.
 * Reference-data, replicable en prod: DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:import:instruments
 *
 * Fuente: packages/db/data/instruments/{lenguaje,matematicas}/*.json (24 con-pauta 2025).
 * Idempotencia: por `instruments.config->>'sourceJson'` (borra el árbol previo y recrea).
 * Valida cada `content` con validateItemContent() de @soe/types antes de insertar.
 * NO aplica tags (ver import-item-tags.ts). NO se llama desde db:seed (no es data demo).
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { readFileSync, readdirSync } from 'node:fs';
import { and, eq, sql } from 'drizzle-orm';
import {
  hasMultipleCorrectAlternatives,
  toApplicationPeriod,
  validateItemContent,
} from '@soe/types';
import { createDbClient, type Database } from '../client';
import { instruments, instrumentSections, sectionAttachments } from '../schema/instruments';
import { itemTaxonomyTags, items } from '../schema/items';
import { subjects, grades } from '../schema/academic';
import { taxonomies } from '../schema/taxonomy';
import { responses } from '../schema/responses';

// Override opcional (INSTRUMENTS_DATA_DIR) para cargar un set aislado sin re-importar el resto
// (ej. la tanda DIA 2026 en su propio dir, sin tocar los instrumentos 2025 ya cargados).
/** `--force` recrea el instrumento aunque tenga tags/respuestas colgando (ver assertSafeToRecreate). */
const FORCE = process.argv.includes('--force');

/** Versión vigente del marco de taxonomía del que cuelga cada tipo de instrumento. */
const MARCO_VERSION: Record<string, string> = { dia: 'vigente', paes: '2026' };

const DATA_DIR = process.env.INSTRUMENTS_DATA_DIR
  ? resolve(process.env.INSTRUMENTS_DATA_DIR)
  : resolve(__dirname, '../../data/instruments');

type Alt = {
  key: string;
  text: string;
  isCorrect?: boolean;
  /** `true` si la alternativa ES una figura (su `text` es una descripción, no el contenido real). */
  isImage?: boolean;
  /** Storage key en S3 del recorte de esa alternativa (contrato v1.1). No es una URL. */
  imageRef?: string | null;
};
/** Elemento de una columna de un ítem de términos pareados. */
type MatchElement = {
  key: string;
  text: string;
  isImage?: boolean;
  imageRef?: string | null;
};
type Item = {
  position: number;
  /**
   * Número tal como lo imprime el cuadernillo ("15.1", "23.4"). Difiere de `position` en los
   * instrumentos con sub-numeración: Ciencias 8° 2026 tiene 43 posiciones correlativas pero
   * imprime `1..13, 14.1..14.5, 15.1..15.4, …`. Sin esto la BDD no tiene forma de saber a qué
   * pregunta impresa corresponde un ítem, que es justo lo que se necesita para cruzar con la
   * hoja de respuestas escaneada (GradeCam numera por el impreso, no por la posición).
   */
  printedNumber?: string | null;
  type: string;
  stem: string;
  alternatives?: Alt[];
  correctKey?: string | null;
  responseFormat?: string;
  hasFigure?: boolean;
  figureNote?: string | null;
  /** Storage key en S3 del recorte de la figura (contrato v1.1). No es una URL. */
  imageRef?: string | null;
  /** Puntaje del ítem. Ausente ⇒ se deriva del tipo (ver `resolvePoints`). */
  points?: number;
  /** Términos pareados — las dos columnas tal como las rotula el documento. */
  matchColumns?: Record<string, MatchElement[]>;
  /** Términos pareados — los pares correctos, en las etiquetas del documento. */
  matchPairs?: { left: string; right: string }[];
};
type Passage = {
  title?: string;
  text: string;
  format?: string;
  attachments?: { kind: string; note?: string }[];
  /** Storage key en S3 del recorte de la región completa del pasaje (contrato v1.1). */
  imageRef?: string | null;
};
type Section = {
  order: number;
  name: string;
  type: string;
  /** `core` (default) o `elective`. Ver `instrument_sections.role`. */
  role?: 'core' | 'elective';
  /** Grupo de alternativas entre las que se elige una (ej. "mencion-ciencias"). */
  electiveGroup?: string | null;
  /** Cuál de las alternativas es esta sección (ej. "BIO"). */
  electiveKey?: string | null;
  instructions?: string;
  passage?: Passage | null;
  /**
   * Storage key del recorte del estímulo de la sección, cuando el estímulo NO es un pasaje de
   * texto: la ilustración de contexto de un Listening, la grilla de apoyo de un bloque de
   * Writing. Va a nivel de sección y no dentro de `passage` porque esas secciones no tienen
   * pasaje (`passage: null`) y su imagen se perdería.
   */
  imageRef?: string | null;
  items: Item[];
};
type InstrumentJson = {
  instrument: {
    name: string;
    subject: string;
    subjectCode: string;
    grade: string;
    gradeCode: string;
    year: number;
    applicationPeriod: string;
    type: string;
    isOfficial?: boolean;
  };
  sections: Section[];
  pauta?: { source?: { instrumentJson?: string }; rubrics?: unknown[] };
  extraction?: { itemCount?: number };
};

/**
 * `{ altImageRefs: {A: key, …} }` si el ítem tiene recortes por alternativa; si no, `null`.
 * Se guarda en `scoringConfig` — ver el comentario en el insert de `items`.
 */
function altImageRefs(it: Item): Record<string, unknown> | null {
  const refs = Object.fromEntries(
    (it.alternatives ?? []).filter((a) => a.imageRef).map((a) => [a.key, a.imageRef]),
  );
  return Object.keys(refs).length ? { altImageRefs: refs } : null;
}

// ── Términos pareados ────────────────────────────────────────────────────────
//
// El `content` de `matching` es genérico: `leftItems` es el lado RESPONDIBLE
// (una entrada de `correctPairs` por elemento) y `rightItems` el banco de
// opciones, donde viven los distractores. Qué columna del documento cae en cada
// lado NO es fijo: en Ciencias 8° los distractores están en la columna A y en
// Historia 6° en la B. Por eso el lado respondible se DEDUCE de los pares en vez
// de hardcodearse, con esta regla:
//
//   el lado respondible es aquel cuyas etiquetas aparecen una sola vez entre los
//   pares Y cubren todos los elementos de su columna
//
// (todo elemento respondible tiene exactamente una respuesta; un elemento del
// banco puede no usarse —distractor— o repetirse —clasificación N → k).

type MatchingSides = {
  answerable: MatchElement[];
  options: MatchElement[];
  pairs: { answerableKey: string; optionKey: string }[];
};

function isAnswerableSide(keys: string[], column: MatchElement[]): boolean {
  const unique = new Set(keys);
  return unique.size === keys.length && unique.size === column.length;
}

/**
 * Adaptador del shape que entrega el pipeline de extracción DIA
 * (`matchColumns: {A, B}` + `matchPairs: [{left, right}]`) al shape genérico.
 * Todo lo específico de DIA vive acá; `buildMatchingContent` no lo conoce.
 */
/**
 * Fallback cuando la capa A no emitió `matchColumns`: los rotulados de las dos
 * columnas están igual en el enunciado, una etiqueta por línea
 * (`A.1 Osmosis`). Se derivan los prefijos de las etiquetas de `matchPairs` y se
 * barre el stem por cada uno — así se recuperan también los distractores, que
 * por definición NO aparecen en los pares.
 *
 * Vive en el adaptador DIA a propósito: es parsing del formato de un proveedor,
 * no parte del contrato de `matching`.
 */
function columnsFromStem(it: Item): Record<string, MatchElement[]> {
  const prefixes = [
    ...new Set((it.matchPairs ?? []).flatMap((p) => [p.left, p.right]).map(labelPrefix)),
  ];
  const columns: Record<string, MatchElement[]> = {};
  for (const prefix of prefixes) {
    const pattern = new RegExp(`^\\s*(${prefix}[.\\s]?\\d+)[.)\\s]+(.+)$`, 'gm');
    const elements: MatchElement[] = [];
    for (const m of it.stem.matchAll(pattern)) {
      const key = m[1]!.replace(/\s+/g, '');
      const text = m[2]!.trim();
      if (text.length > 0) elements.push({ key, text });
    }
    if (elements.length > 0) columns[prefix] = elements;
  }
  return columns;
}

function labelPrefix(label: string): string {
  return label.replace(/[.\s]?\d+$/, '');
}

function diaMatchingSides(it: Item): MatchingSides {
  const columns =
    it.matchColumns && Object.keys(it.matchColumns).length > 0
      ? it.matchColumns
      : columnsFromStem(it);
  const names = Object.keys(columns);
  if (names.length !== 2) {
    throw new Error(
      `Ítem ${it.position}: matchColumns debe traer exactamente 2 columnas, trae ${names.length}`,
    );
  }
  const pairs = it.matchPairs ?? [];
  if (pairs.length === 0) {
    throw new Error(`Ítem ${it.position}: matchPairs vacío en un ítem de términos pareados`);
  }

  const [firstName, secondName] = names as [string, string];
  const first = columns[firstName] ?? [];
  const second = columns[secondName] ?? [];
  const leftKeys = pairs.map((p) => p.left);
  const rightKeys = pairs.map((p) => p.right);

  const leftIsAnswerable = isAnswerableSide(leftKeys, first);
  const rightIsAnswerable = isAnswerableSide(rightKeys, second);

  if (leftIsAnswerable === rightIsAnswerable) {
    // Biyección perfecta (ambos lados califican) o dato inconsistente (ninguno).
    // En el primer caso da igual cuál se elija; en el segundo hay que fallar
    // ruidoso, porque adivinar el lado corrige mal sin fallar nunca.
    if (!leftIsAnswerable) {
      throw new Error(
        `Ítem ${it.position}: no se puede deducir el lado respondible de los pares ` +
          `(${leftKeys.length} pares, columnas de ${first.length} y ${second.length})`,
      );
    }
  }

  return leftIsAnswerable
    ? {
        answerable: first,
        options: second,
        pairs: pairs.map((p) => ({ answerableKey: p.left, optionKey: p.right })),
      }
    : {
        answerable: second,
        options: first,
        pairs: pairs.map((p) => ({ answerableKey: p.right, optionKey: p.left })),
      };
}

function toMatchingElement(el: MatchElement): Record<string, unknown> {
  return {
    id: el.key,
    text: el.text,
    label: el.key,
    ...(el.isImage ? { isImage: true } : {}),
  };
}

function buildMatchingContent(it: Item): Record<string, unknown> {
  const { answerable, options, pairs } = diaMatchingSides(it);
  return {
    prompt: it.stem,
    leftItems: answerable.map(toMatchingElement),
    rightItems: options.map(toMatchingElement),
    correctPairs: pairs.map((p) => ({ leftId: p.answerableKey, rightId: p.optionKey })),
  };
}

/** `{ matchImageRefs: {"B.1": key, …} }` con los recortes de ambas columnas, o `null`. */
function matchImageRefs(it: Item): Record<string, unknown> | null {
  const refs = Object.fromEntries(
    Object.values(it.matchColumns ?? {})
      .flat()
      .filter((el) => el.imageRef)
      .map((el) => [el.key, el.imageRef]),
  );
  return Object.keys(refs).length ? { matchImageRefs: refs } : null;
}

/** Nº de pares correctos declarados, para derivar el puntaje por defecto. */
function matchingPairCount(it: Item): number {
  return (it.matchPairs ?? []).length;
}

function buildTrueFalseContent(it: Item): Record<string, unknown> {
  const correct = (it.alternatives ?? []).find((a) => a.isCorrect === true);
  if (!correct) {
    throw new Error(`Ítem ${it.position}: true_false sin alternativa correcta declarada`);
  }
  const normalized = `${correct.key} ${correct.text}`.trim().toUpperCase();
  const isTrue = /\b(V|VERDADERO|TRUE|T|SÍ|SI)\b/.test(normalized);
  const isFalse = /\b(F|FALSO|FALSE)\b/.test(normalized);
  if (isTrue === isFalse) {
    throw new Error(
      `Ítem ${it.position}: no se puede resolver V/F desde la alternativa correcta "${correct.key}. ${correct.text}"`,
    );
  }
  return { stem: it.stem, correctAnswer: isTrue };
}

/**
 * Tipo REAL del ítem. El pipeline de extracción tipa los términos pareados como
 * `open_ended` + `responseFormat: "match_pairs"` — deuda tomada cuando `matching`
 * no tenía camino de carga. Un ítem que declara sus pares ES un pareado, así que
 * se normaliza acá en vez de exigir re-extraer los PDF.
 *
 * Es el mismo criterio que el resto del adaptador: el dato manda sobre la
 * etiqueta que le puso la capa de extracción.
 */
function resolveItemType(it: Item): string {
  if (it.type === 'matching') return 'matching';
  if ((it.matchPairs ?? []).length > 0 || it.responseFormat === 'match_pairs') return 'matching';
  if (it.type === 'true_false' || isTrueFalseAlternatives(it)) return 'true_false';
  if (
    it.type === 'multi_select' ||
    hasMultipleCorrectAlternatives({ alternatives: it.alternatives })
  )
    return 'multi_select';
  return it.type;
}

/**
 * ¿Las alternativas son exactamente Verdadero/Falso? La extracción tipa estos
 * ítems como `multiple_choice` con `A. Verdadero` / `B. Falso`, pero la hoja de
 * respuestas los escanea como `V`/`F`: corregirlos contra la LETRA da siempre
 * incorrecto (verificado contra los scans reales de Ciencias 8°, donde los 9
 * ítems V/F puntuaban 0). Como `true_false`, la estrategia normaliza ambas
 * formas a una clave canónica y el escaneo calza.
 */
function isTrueFalseAlternatives(it: Item): boolean {
  const alternatives = it.alternatives ?? [];
  if (alternatives.length !== 2) return false;
  const texts = alternatives.map((a) => a.text.trim().toLowerCase());
  return texts.includes('verdadero') && texts.includes('falso');
}

export function buildContent(it: Item): Record<string, unknown> {
  // Siempre por el tipo RESUELTO, nunca por `it.type`: los V/F llegan tipados
  // como multiple_choice y la rama MCQ se los tragaría antes de llegar a la suya.
  switch (resolveItemType(it)) {
    case 'matching':
      return buildMatchingContent(it);
    case 'true_false':
      return buildTrueFalseContent(it);
    case 'multi_select':
    case 'multiple_choice':
      return {
        stem: it.stem,
        alternatives: (it.alternatives ?? []).map((a) => ({
          key: a.key,
          text: a.text,
          isCorrect: a.isCorrect === true,
        })),
      };
    default:
      // open_ended (incluye responseFormat fill_in / develop), writing, etc.
      return { prompt: it.stem };
  }
}

/**
 * Puntaje del ítem. El JSON manda; si no lo declara, un pareado vale un punto por
 * par (la convención de la Agencia, y el default razonable en general) y todo lo
 * demás vale 1.
 */
export function resolvePoints(it: Item): number {
  if (typeof it.points === 'number' && it.points >= 0) return it.points;
  if (resolveItemType(it) === 'matching') return matchingPairCount(it) || 1;
  return 1;
}

/**
 * Guard: este import es idempotente **borrando y recreando** el árbol del
 * instrumento, y eso regenera los UUID de los ítems. El daño no es uniforme:
 *
 *   · `item_taxonomy_tags`, `item_versions`, `item_edit_proposals` cuelgan con
 *     ON DELETE CASCADE ⇒ se destruyen EN SILENCIO;
 *   · `responses`, `assessment_item_stats`, `item_collection_items` NO declaran
 *     onDelete ⇒ el DELETE falla y la transacción revierte (molesto, pero seguro).
 *
 * Así que lo peligroso es re-importar un instrumento ya TAGUEADO: se pierde el
 * trabajo de etiquetado sin ningún aviso. Antes de borrar se cuenta lo que
 * colgaría y se aborta con el detalle, salvo `--force`.
 *
 * Para cambiar ítems ya cargados el camino correcto es UPDATE in-place
 * (`db:retype:items`), no re-import.
 */
async function assertSafeToRecreate(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  instrumentId: string,
  instrumentName: string,
): Promise<void> {
  if (FORCE) return;

  const [counts] = await tx
    .select({
      tags: sql<number>`(select count(*)::int from ${itemTaxonomyTags} t
        join ${items} i on i.id = t.item_id where i.instrument_id = ${instrumentId})`,
      responses: sql<number>`(select count(*)::int from ${responses} r
        join ${items} i on i.id = r.item_id where i.instrument_id = ${instrumentId})`,
    })
    .from(instruments)
    .where(eq(instruments.id, instrumentId));

  const tags = Number(counts?.tags ?? 0);
  const responseCount = Number(counts?.responses ?? 0);
  if (tags === 0 && responseCount === 0) return;

  throw new Error(
    `"${instrumentName}" ya está cargado y tiene datos dependientes:\n` +
      `  · ${tags} item_taxonomy_tags   → se PERDERÍAN (ON DELETE CASCADE)\n` +
      `  · ${responseCount} responses            → bloquearían el DELETE\n` +
      'Re-importar borra y recrea los ítems (regenera sus UUID). Para cambiar ítems ya\n' +
      'cargados usá UPDATE in-place (pnpm --filter @soe/db db:retype:items), no re-import.\n' +
      'Si de verdad querés recrear el instrumento desde cero, re-corré con --force.',
  );
}

export async function importInstruments(db: Database): Promise<void> {
  const subjRows = await db.select({ id: subjects.id, code: subjects.code }).from(subjects);
  const gradeRows = await db.select({ id: grades.id, code: grades.code }).from(grades);
  const subjId = new Map(subjRows.map((s) => [s.code, s.id]));
  const gradeId = new Map(gradeRows.map((g) => [g.code, g.id]));
  // El marco y el `type` del instrumento salen del JSON, no están fijos: el mismo importador
  // carga los DIA y los ensayos PAES, que cuelgan de otro marco. Solo se buscan los marcos
  // que los archivos de esta corrida realmente usan, para no exigir el de PAES en un repo
  // que todavía no lo sembró.
  const marcoRows = await db
    .select({ id: taxonomies.id, type: taxonomies.type, version: taxonomies.version })
    .from(taxonomies);
  // Se indexa por el nombre del marco como string: `taxonomy_type` e `instrument_type` son
  // enums distintos que comparten los valores 'dia' y 'paes', y no son intercambiables.
  const marcoPorTipo = new Map<string, string>(
    marcoRows
      .filter((m) => MARCO_VERSION[m.type] === m.version)
      .map((m) => [m.type as string, m.id]),
  );

  const files: string[] = [];
  for (const entry of readdirSync(DATA_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = resolve(DATA_DIR, entry.name);
    for (const f of readdirSync(dir)) if (f.endsWith('.json')) files.push(resolve(dir, f));
  }

  let nInst = 0,
    nSec = 0,
    nItem = 0;
  const issues: string[] = [];

  for (const file of files.sort()) {
    const d = JSON.parse(readFileSync(file, 'utf-8')) as InstrumentJson;
    const ins = d.instrument;
    const sourceJson = d.pauta?.source?.instrumentJson ?? `imported/${ins.name}`;
    const sId = subjId.get(ins.subjectCode) ?? null;
    const gId = gradeId.get(ins.gradeCode) ?? null;
    if (!sId || !gId) {
      issues.push(`${ins.name}: subject/grade no resuelto (${ins.subjectCode}/${ins.gradeCode})`);
      continue;
    }
    const instrumentType = (ins.type ?? 'dia') as typeof instruments.$inferInsert.type;
    const marcoId = marcoPorTipo.get(instrumentType) ?? null;
    if (!marcoId) {
      issues.push(
        `${ins.name}: falta el marco de taxonomía '${instrumentType}' ` +
          `(version=${MARCO_VERSION[instrumentType] ?? '?'}). ` +
          `Corre el seed de ese marco antes de importar.`,
      );
      continue;
    }

    await db.transaction(async (tx) => {
      // 1) borrar import previo (idempotencia) por sourceJson — bottom-up
      const prev = await tx
        .select({ id: instruments.id })
        .from(instruments)
        .where(sql`${instruments.config} ->> 'sourceJson' = ${sourceJson}`);
      for (const p of prev) {
        await assertSafeToRecreate(tx, p.id, ins.name);
        await tx.delete(items).where(eq(items.instrumentId, p.id)); // cascade: item_taxonomy_tags
        await tx.delete(instruments).where(eq(instruments.id, p.id)); // cascade: sections → section_attachments
      }

      // 2) instrumento
      const [inst] = await tx
        .insert(instruments)
        .values({
          orgId: null,
          taxonomyId: marcoId,
          name: ins.name,
          type: instrumentType,
          subjectId: sId,
          gradeId: gId,
          year: ins.year,
          applicationPeriod: toApplicationPeriod(ins.applicationPeriod),
          isOfficial: ins.isOfficial ?? true,
          status: 'published',
          config: {
            sourceJson,
            subject: ins.subject,
            grade: ins.grade,
            // Rúbricas de las preguntas de desarrollo, tal como vienen de la pauta oficial.
            // Se preservan aquí porque las tablas `rubrics`/`rubric_criteria`/`rubric_levels`
            // todavía no tienen camino de carga; así el dato no se pierde en la extracción.
            ...(d.pauta?.rubrics?.length ? { rubrics: d.pauta.rubrics } : {}),
          },
        })
        .returning({ id: instruments.id });
      const instrumentId = inst!.id;
      nInst++;

      // 3) secciones (+ pasaje + adjuntos) e ítems
      let itemCount = 0;
      for (const s of d.sections) {
        const p = s.passage ?? null;
        const [sec] = await tx
          .insert(instrumentSections)
          .values({
            instrumentId,
            name: s.name,
            type: s.type as typeof instrumentSections.$inferInsert.type,
            order: s.order ?? 0,
            instructions: s.instructions ?? null,
            // Rol de la sección (tronco común / rama electiva). Ausente ⇒ `core`, que es el
            // default de la columna: los JSON existentes se importan igual que siempre.
            role: (s.role ?? 'core') as typeof instrumentSections.$inferInsert.role,
            electiveGroup: s.role === 'elective' ? (s.electiveGroup ?? null) : null,
            electiveKey: s.role === 'elective' ? (s.electiveKey ?? null) : null,
            passageTitle: p?.title ?? null,
            passageText: p?.text ?? null,
            passageFormat: p
              ? ((p.format ?? 'plain') as typeof instrumentSections.$inferInsert.passageFormat)
              : null,
          })
          .returning({ id: instrumentSections.id });
        const sectionId = sec!.id;
        nSec++;
        // Recorte de la región completa del pasaje (contrato v1.1). Va primero (order 0) porque es
        // el único adjunto con archivo real: los `p.attachments` son descripciones escritas por IA
        // y no son fiables (funden varias imágenes en una entrada y a veces las omiten).
        const attachments: (typeof sectionAttachments.$inferInsert)[] = [];
        // `s.imageRef` cubre las secciones cuyo estímulo no es un pasaje de texto (ilustración de
        // un Listening, grilla de apoyo de un Writing): ahí `passage` es null y el recorte se
        // declara a nivel de sección.
        const sectionImageRef = p?.imageRef ?? s.imageRef ?? null;
        if (sectionImageRef) {
          attachments.push({
            sectionId,
            kind: 'image',
            order: 0,
            storageKey: sectionImageRef,
            mimeType: 'image/png',
            note: p
              ? 'Pasaje completo tal como aparece en el cuadernillo (recorte determinístico).'
              : 'Estímulo de la sección tal como aparece en el cuadernillo (recorte determinístico).',
          });
        }
        for (const [i, a] of (p?.attachments ?? []).entries()) {
          attachments.push({
            sectionId,
            kind: a.kind as typeof sectionAttachments.$inferInsert.kind,
            order: i + 1,
            note: a.note ?? null,
          });
        }
        if (attachments.length) {
          await tx.insert(sectionAttachments).values(attachments);
        }
        for (const it of s.items) {
          const itemType = resolveItemType(it);
          const content = validateItemContent(
            itemType as Parameters<typeof validateItemContent>[0],
            buildContent(it),
          );
          await tx.insert(items).values({
            orgId: null,
            instrumentId,
            sectionId,
            position: it.position,
            type: itemType as typeof items.$inferInsert.type,
            content,
            scoringConfig: {
              points: resolvePoints(it),
              partialCredit: itemType !== 'multiple_choice' && itemType !== 'true_false',
              ...(it.responseFormat ? { responseFormat: it.responseFormat } : {}),
              // Número impreso (ver el tipo `Item`). Va en scoringConfig por el mismo motivo que
              // `imageRef`: el schema Zod de `content` descarta las claves que no declara.
              ...(it.printedNumber && it.printedNumber !== String(it.position)
                ? { printedNumber: it.printedNumber }
                : {}),
              ...(it.hasFigure ? { hasFigure: true, figureNote: it.figureNote ?? null } : {}),
              // Storage key de la figura recortada (contrato v1.1). Va en scoringConfig y no
              // en `content` porque el schema Zod de content strippea claves desconocidas y
              // `imageUrl` exige una URL absoluta — el bucket es privado y las presigned
              // expiran. Cómo se sirve la imagen es una decisión aparte, aún abierta.
              ...(it.imageRef ? { imageRef: it.imageRef } : {}),
              // Recortes por alternativa: {A: key, B: key, …}. Mismo motivo para NO ponerlos en
              // `content`: el schema de alternativa es {key,text,isCorrect} y Zod descarta el resto.
              ...(altImageRefs(it) ?? {}),
              // Recortes de los elementos de un pareado: {"B.1": key, …}. Mismo motivo.
              // Los pares y las columnas NO se copian acá: desde que `matching` tiene camino
              // de carga, viven en `content` (leftItems/rightItems/correctPairs) y duplicarlos
              // en scoringConfig sería una segunda fuente de verdad de lo mismo.
              ...(matchImageRefs(it) ?? {}),
            },
            status: 'published',
            source: 'imported',
          });
          nItem++;
          itemCount++;
        }
      }
      const declared = d.extraction?.itemCount;
      const flag =
        declared != null && declared !== itemCount
          ? ` ⚠️ itemCount JSON=${declared} ≠ ${itemCount}`
          : '';
      console.log(`  ✓ ${ins.name}: ${itemCount} ítems${flag}`);
    });
  }

  console.log(`\nImport: ${nInst} instrumentos · ${nSec} secciones · ${nItem} ítems`);
  if (issues.length) {
    console.log('Issues:');
    issues.forEach((i) => console.log('  ✗', i));
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  importInstruments(createDbClient(url))
    .then(() => {
      console.log('✅ Instrumentos importados.');
      process.exit(0);
    })
    .catch((e) => {
      console.error('ERROR import instrumentos:', e);
      process.exit(1);
    });
}
