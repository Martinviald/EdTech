/**
 * Re-tipifica ítems cargados como `open_ended` que en realidad son evaluados por
 * pauta: la respuesta ingresada es el CÓDIGO del nivel que asignó quien corrigió,
 * no un texto a corregir. Pasan a `rubric_scored` y quedan autocorregibles.
 *
 * La detección no mira nombres ni posiciones: exige que DOS señales independientes
 * coincidan, porque cada una por separado se equivoca en un caso real.
 *
 *  · Lo DECLARA el instrumento: `scoring_config.responseFormat = 'develop'`. Así
 *    marca el pipeline de extracción los ítems de desarrollo con pauta; `fill_in`
 *    es respuesta corta con valor, que necesita clave y no escala.
 *  · Lo CONFIRMA el dato: al menos `--min-coverage` de las respuestas cae dentro
 *    de la escala, tolerando el cero a la izquierda ("02" es el código 2).
 *
 * Por qué la conjunción y no cualquiera de las dos: en DIA 2026 hay un ítem
 * `develop` cuyas respuestas son fracciones (Matemática 5° p7, 0% de cobertura)
 * y un `fill_in` cuya clave es un dígito chico, así que el 87% de sus respuestas
 * PARECE una escala (Matemática 7° p29). El vocabulario solo se traga el segundo;
 * la declaración sola se traga el primero. Juntas, ninguno.
 *
 * Los valores que queden fuera de la escala no vetan al ítem: al corregir, un
 * código desconocido cae en `requiresManualGrading` y esa respuesta queda
 * pendiente sin contaminar el puntaje de las demás. Se listan igual, para que
 * nadie tenga que descubrirlos después.
 *
 * Actualiza IN PLACE (nunca borra y recrea): re-importar el instrumento
 * regeneraría los UUID de los ítems y orfanaría sus tags y respuestas.
 *
 *   Dry-run:  DATABASE_ADMIN_URL=... pnpm --filter @soe/db exec tsx "src/scripts/retype-open-ended-items.ts"
 *   Commit:   ... --commit
 *
 * Args: --org=<uuid> --year=<año> --levels=<code:credit,...> --min-coverage=<0..1>
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, inArray, sql as dsql } from 'drizzle-orm';
import * as schema from '../schema';
import { withOrgContext } from '../with-org-context';
import { items } from '../schema/items';
import { instruments } from '../schema/instruments';
import { responses } from '../schema/responses';
import { assessments } from '../schema/assessments';
import { normalizeRubricCode, rubricScoredContentSchema } from '@soe/types';

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const opt = (name: string, def: string): string => {
  const p = argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : def;
};
const ORG_ID = opt('org', 'c5c10000-0000-0000-0000-000000000001');
const YEAR = parseInt(opt('year', '2026'), 10);

/**
 * Escala por defecto: la codificación oficial de la Agencia (Código 2/1/0). No
 * está hardcodeada en el modelo — se declara acá y viaja al `content` del ítem,
 * así otra escala sólo cambia este argumento.
 */
const LEVELS = opt('levels', '0:0,1:0.5,2:1')
  .split(',')
  .map((pair) => {
    const [code, credit] = pair.split(':');
    if (!code || credit === undefined) throw new Error(`Nivel mal formado: "${pair}"`);
    return { code: code.trim(), creditFraction: Number(credit) };
  });
const LEVEL_LABELS: Record<string, string> = {
  '0': 'Incorrecta',
  '1': 'Parcialmente correcta',
  '2': 'Correcta',
};

/** El `responseFormat` con el que el pipeline marca "desarrollo evaluado por pauta". */
const RUBRIC_RESPONSE_FORMAT = 'develop';

/**
 * Umbral de confirmación por dato. El corte real en DIA 2026 es abismal — el ítem
 * de pauta peor cubierto llega a 97,5% y el `develop` que NO es pauta se queda en
 * 0% — así que cualquier valor dentro de ese hueco separa igual. 0,95 deja margen
 * para unas pocas celdas sucias sin acercarse al otro grupo.
 */
const MIN_COVERAGE = Number(opt('min-coverage', '0.95'));
if (!Number.isFinite(MIN_COVERAGE) || MIN_COVERAGE <= 0 || MIN_COVERAGE > 1) {
  throw new Error(`--min-coverage debe estar en (0, 1]; llegó "${MIN_COVERAGE}"`);
}

/**
 * La misma tolerancia al cero a la izquierda que aplica la estrategia al corregir
 * (`normalizeRubricCode`). Comparten la función a propósito: si acá "02" contara
 * como código y allá no, el ítem se re-tipificaría y después esas respuestas
 * quedarían pendientes sin que nadie entendiera por qué.
 */
const normalizeCode = normalizeRubricCode;

const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('Falta DATABASE_ADMIN_URL');
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const client = postgres(url, {
  max: 1,
  connect_timeout: 15,
  ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
});
const db = drizzle(client, { schema });

function promptOf(content: unknown): string {
  const c = content as { prompt?: unknown; stem?: unknown } | null;
  if (typeof c?.prompt === 'string' && c.prompt.trim()) return c.prompt;
  if (typeof c?.stem === 'string' && c.stem.trim()) return c.stem;
  return 'Pregunta de desarrollo';
}

async function main() {
  const codes = new Set(LEVELS.map((l) => l.code));

  await withOrgContext(db, ORG_ID, async (tx) => {
    const candidates = await tx
      .select({
        id: items.id,
        position: items.position,
        content: items.content,
        scoringConfig: items.scoringConfig,
        instrumentName: instruments.name,
      })
      .from(items)
      .innerJoin(instruments, eq(instruments.id, items.instrumentId))
      .where(
        and(
          eq(items.type, 'open_ended'),
          eq(instruments.year, YEAR),
          dsql`${items.deletedAt} is null`,
          dsql`${instruments.deletedAt} is null`,
        ),
      );
    if (candidates.length === 0) {
      console.log(`No hay ítems open_ended en instrumentos de ${YEAR}.`);
      return;
    }

    const vocab = await tx
      .select({
        itemId: responses.itemId,
        answer: dsql<string | null>`${responses.value}->>'answer'`,
        n: dsql<number>`count(*)::int`,
      })
      .from(responses)
      .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
      .where(
        and(
          eq(assessments.orgId, ORG_ID),
          inArray(
            responses.itemId,
            candidates.map((c) => c.id),
          ),
        ),
      )
      .groupBy(responses.itemId, dsql`${responses.value}->>'answer'`);

    const valuesByItem = new Map<string, Map<string, number>>();
    for (const row of vocab) {
      const answer = row.answer?.trim();
      if (!answer) continue;
      const counts = valuesByItem.get(row.itemId) ?? new Map<string, number>();
      counts.set(answer, (counts.get(answer) ?? 0) + Number(row.n));
      valuesByItem.set(row.itemId, counts);
    }

    /** Cobertura = proporción de respuestas cuyo valor cae dentro de la escala. */
    function coverageOf(counts: Map<string, number>): {
      coverage: number;
      outside: Array<{ value: string; n: number }>;
    } {
      let inScale = 0;
      let total = 0;
      const outside: Array<{ value: string; n: number }> = [];
      for (const [value, n] of counts) {
        total += n;
        if (codes.has(normalizeCode(value))) inScale += n;
        else outside.push({ value, n });
      }
      outside.sort((a, b) => b.n - a.n);
      return { coverage: total === 0 ? 0 : inScale / total, outside };
    }

    type Candidate = (typeof candidates)[number];
    const toRetype: Array<{ item: Candidate; outside: Array<{ value: string; n: number }> }> = [];
    const skipped: Array<{ item: Candidate; reason: string }> = [];
    for (const item of candidates) {
      const declared = (item.scoringConfig as { responseFormat?: unknown } | null)?.responseFormat;
      if (declared !== RUBRIC_RESPONSE_FORMAT) {
        skipped.push({ item, reason: `responseFormat="${String(declared ?? '-')}" (no es pauta)` });
        continue;
      }
      const counts = valuesByItem.get(item.id);
      if (!counts || counts.size === 0) {
        skipped.push({ item, reason: 'sin respuestas cargadas' });
        continue;
      }
      const { coverage, outside } = coverageOf(counts);
      if (coverage < MIN_COVERAGE) {
        skipped.push({
          item,
          reason: `cobertura ${(coverage * 100).toFixed(1)}% < ${(MIN_COVERAGE * 100).toFixed(0)}% — valores: ${outside
            .slice(0, 5)
            .map((o) => `${o.value}×${o.n}`)
            .join(', ')}`,
        });
        continue;
      }
      toRetype.push({ item, outside });
    }

    console.log(
      `\n== Re-tipificación open_ended → rubric_scored · ${YEAR} · ${COMMIT ? 'COMMIT' : 'DRY-RUN'} ==`,
    );
    console.log(`  escala: ${LEVELS.map((l) => `${l.code}→${l.creditFraction}`).join('  ')}`);
    console.log(
      `  señales: responseFormat="${RUBRIC_RESPONSE_FORMAT}" + cobertura ≥ ${(MIN_COVERAGE * 100).toFixed(0)}%`,
    );
    console.log(`  candidatos open_ended: ${candidates.length}`);
    console.log(`  a re-tipificar: ${toRetype.length}\n`);
    let pendingCells = 0;
    for (const { item, outside } of toRetype) {
      const dirty = outside.reduce((s, o) => s + o.n, 0);
      pendingCells += dirty;
      const note = dirty
        ? `  ⚠ ${dirty} respuesta(s) fuera de escala quedan pendientes: ${outside
            .map((o) => `${o.value}×${o.n}`)
            .join(', ')}`
        : '';
      console.log(`    ✓ ${item.instrumentName} · pos ${item.position}${note}`);
    }
    if (pendingCells) {
      console.log(
        `\n  ${pendingCells} respuesta(s) con código no reconocido quedarán sin corregir (no arrastran al resto del ítem).`,
      );
    }

    // Detalle sólo de los rechazos que el instrumento DECLARÓ como pauta: son los
    // únicos discutibles. El resto (`fill_in`, sin respuestas) se resume en una línea.
    const nearMisses = skipped.filter((s) => s.reason.startsWith('cobertura'));
    const others = skipped.length - nearMisses.length;
    if (nearMisses.length) {
      console.log(`\n  declarados "${RUBRIC_RESPONSE_FORMAT}" pero el dato no confirma la escala:`);
      for (const s of nearMisses) {
        console.log(`    · ${s.item.instrumentName} · pos ${s.item.position} — ${s.reason}`);
      }
    }
    if (others) {
      const noRubric = skipped.filter((s) => s.reason.startsWith('responseFormat')).length;
      const noResponses = skipped.filter((s) => s.reason.startsWith('sin respuestas')).length;
      console.log(
        `\n  se dejan como open_ended (${others}): ${noRubric} no son de pauta (respuesta corta → necesitan la clave de la ficha técnica), ${noResponses} sin respuestas cargadas.`,
      );
    }

    if (!COMMIT) {
      console.log('\n(dry-run: no se escribió nada. Re-corre con --commit)');
      return;
    }
    if (toRetype.length === 0) return;

    for (const { item } of toRetype) {
      const content = rubricScoredContentSchema.parse({
        prompt: promptOf(item.content),
        levels: LEVELS.map((l) => ({
          code: l.code,
          label: LEVEL_LABELS[l.code],
          creditFraction: l.creditFraction,
        })),
      });
      await tx
        .update(items)
        .set({ type: 'rubric_scored', content, updatedAt: new Date() })
        .where(eq(items.id, item.id));
    }

    console.log(`\n✅ COMMIT: ${toRetype.length} ítems re-tipificados a rubric_scored`);
    console.log('   Recuerda re-correr la ingesta de respuestas y el backfill del read-model.');
  });

  await client.end();
}

main().catch((e) => {
  console.error('ERR:', e);
  process.exit(1);
});
