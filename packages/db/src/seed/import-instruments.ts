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
import { toApplicationPeriod, validateItemContent } from '@soe/types';
import { createDbClient, type Database } from '../client';
import { instruments, instrumentSections, sectionAttachments } from '../schema/instruments';
import { items } from '../schema/items';
import { subjects, grades } from '../schema/academic';
import { taxonomies } from '../schema/taxonomy';

// Override opcional (INSTRUMENTS_DATA_DIR) para cargar un set aislado sin re-importar el resto
// (ej. la tanda DIA 2026 en su propio dir, sin tocar los instrumentos 2025 ya cargados).
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
type Item = {
  position: number; type: string; stem: string; alternatives?: Alt[];
  correctKey?: string | null; responseFormat?: string; hasFigure?: boolean; figureNote?: string | null;
  /** Storage key en S3 del recorte de la figura (contrato v1.1). No es una URL. */
  imageRef?: string | null;
};
type Passage = {
  title?: string;
  text: string;
  format?: string;
  attachments?: { kind: string; note?: string }[];
  /** Storage key en S3 del recorte de la región completa del pasaje (contrato v1.1). */
  imageRef?: string | null;
};
type Section = { order: number; name: string; type: string; instructions?: string; passage?: Passage | null; items: Item[] };
type InstrumentJson = {
  instrument: { name: string; subject: string; subjectCode: string; grade: string; gradeCode: string;
    year: number; applicationPeriod: string; type: string; isOfficial?: boolean };
  sections: Section[];
  pauta?: { source?: { instrumentJson?: string } };
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

function buildContent(it: Item): Record<string, unknown> {
  if (it.type === 'multiple_choice' || it.type === 'true_false') {
    return {
      stem: it.stem,
      alternatives: (it.alternatives ?? []).map((a) => ({
        key: a.key, text: a.text, isCorrect: a.isCorrect === true,
      })),
    };
  }
  // open_ended (incluye responseFormat fill_in / develop), writing, etc.
  return { prompt: it.stem };
}

export async function importInstruments(db: Database): Promise<void> {
  const subjRows = await db.select({ id: subjects.id, code: subjects.code }).from(subjects);
  const gradeRows = await db.select({ id: grades.id, code: grades.code }).from(grades);
  const subjId = new Map(subjRows.map((s) => [s.code, s.id]));
  const gradeId = new Map(gradeRows.map((g) => [g.code, g.id]));
  const [diaMarco] = await db
    .select({ id: taxonomies.id })
    .from(taxonomies)
    .where(and(eq(taxonomies.type, 'dia'), eq(taxonomies.version, 'vigente')));
  if (!diaMarco) throw new Error('Falta el marco DIA (type=dia, version=vigente). Corre db:seed:taxonomy.');

  const files: string[] = [];
  for (const sub of ['lenguaje', 'matematicas']) {
    const dir = resolve(DATA_DIR, sub);
    for (const f of readdirSync(dir)) if (f.endsWith('.json')) files.push(resolve(dir, f));
  }

  let nInst = 0, nSec = 0, nItem = 0;
  const issues: string[] = [];

  for (const file of files.sort()) {
    const d = JSON.parse(readFileSync(file, 'utf-8')) as InstrumentJson;
    const ins = d.instrument;
    const sourceJson = d.pauta?.source?.instrumentJson ?? `imported/${ins.name}`;
    const sId = subjId.get(ins.subjectCode) ?? null;
    const gId = gradeId.get(ins.gradeCode) ?? null;
    if (!sId || !gId) { issues.push(`${ins.name}: subject/grade no resuelto (${ins.subjectCode}/${ins.gradeCode})`); continue; }

    await db.transaction(async (tx) => {
      // 1) borrar import previo (idempotencia) por sourceJson — bottom-up
      const prev = await tx
        .select({ id: instruments.id })
        .from(instruments)
        .where(sql`${instruments.config} ->> 'sourceJson' = ${sourceJson}`);
      for (const p of prev) {
        await tx.delete(items).where(eq(items.instrumentId, p.id)); // cascade: item_taxonomy_tags
        await tx.delete(instruments).where(eq(instruments.id, p.id)); // cascade: sections → section_attachments
      }

      // 2) instrumento
      const [inst] = await tx
        .insert(instruments)
        .values({
          orgId: null,
          taxonomyId: diaMarco.id,
          name: ins.name,
          type: 'dia',
          subjectId: sId,
          gradeId: gId,
          year: ins.year,
          applicationPeriod: toApplicationPeriod(ins.applicationPeriod),
          isOfficial: ins.isOfficial ?? true,
          status: 'published',
          config: { sourceJson, subject: ins.subject, grade: ins.grade },
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
            passageTitle: p?.title ?? null,
            passageText: p?.text ?? null,
            passageFormat: p ? ((p.format ?? 'plain') as typeof instrumentSections.$inferInsert.passageFormat) : null,
          })
          .returning({ id: instrumentSections.id });
        const sectionId = sec!.id;
        nSec++;
        // Recorte de la región completa del pasaje (contrato v1.1). Va primero (order 0) porque es
        // el único adjunto con archivo real: los `p.attachments` son descripciones escritas por IA
        // y no son fiables (funden varias imágenes en una entrada y a veces las omiten).
        const attachments: (typeof sectionAttachments.$inferInsert)[] = [];
        if (p?.imageRef) {
          attachments.push({
            sectionId,
            kind: 'image',
            order: 0,
            storageKey: p.imageRef,
            mimeType: 'image/png',
            note: 'Pasaje completo tal como aparece en el cuadernillo (recorte determinístico).',
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
          const content = validateItemContent(
            it.type as Parameters<typeof validateItemContent>[0],
            buildContent(it),
          );
          await tx.insert(items).values({
            orgId: null,
            instrumentId,
            sectionId,
            position: it.position,
            type: it.type as typeof items.$inferInsert.type,
            content,
            scoringConfig: {
              points: 1,
              partialCredit: it.type !== 'multiple_choice' && it.type !== 'true_false',
              ...(it.responseFormat ? { responseFormat: it.responseFormat } : {}),
              ...(it.hasFigure ? { hasFigure: true, figureNote: it.figureNote ?? null } : {}),
              // Storage key de la figura recortada (contrato v1.1). Va en scoringConfig y no
              // en `content` porque el schema Zod de content strippea claves desconocidas y
              // `imageUrl` exige una URL absoluta — el bucket es privado y las presigned
              // expiran. Cómo se sirve la imagen es una decisión aparte, aún abierta.
              ...(it.imageRef ? { imageRef: it.imageRef } : {}),
              // Recortes por alternativa: {A: key, B: key, …}. Mismo motivo para NO ponerlos en
              // `content`: el schema de alternativa es {key,text,isCorrect} y Zod descarta el resto.
              ...(altImageRefs(it) ?? {}),
            },
            status: 'published',
            source: 'imported',
          });
          nItem++; itemCount++;
        }
      }
      const declared = d.extraction?.itemCount;
      const flag = declared != null && declared !== itemCount ? ` ⚠️ itemCount JSON=${declared} ≠ ${itemCount}` : '';
      console.log(`  ✓ ${ins.name}: ${itemCount} ítems${flag}`);
    });
  }

  console.log(`\nImport: ${nInst} instrumentos · ${nSec} secciones · ${nItem} ítems`);
  if (issues.length) { console.log('Issues:'); issues.forEach((i) => console.log('  ✗', i)); }
}

if (require.main === module) {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  importInstruments(createDbClient(url))
    .then(() => { console.log('✅ Instrumentos importados.'); process.exit(0); })
    .catch((e) => { console.error('ERROR import instrumentos:', e); process.exit(1); });
}
