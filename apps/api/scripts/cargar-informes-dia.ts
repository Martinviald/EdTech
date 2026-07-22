/**
 * Carga los informes oficiales DIA (JSON extraídos por la skill `extraer-informes-dia`)
 * a la BDD demo, vía el importador REAL (upload → preview → confirm).
 *
 * Fase 6 del plan. Instancia el `OfficialReportImportService` standalone (sin HTTP ni
 * auth guard) y llama sus métodos públicos con un `JwtPayload` sintético de CSCJ, así
 * corre EXACTAMENTE el código del importador —los 5 gates y los writes— sin riesgo de
 * divergencia con lo que hace la API.
 *
 * Uso (con el túnel a demo arriba, ver skill demo-db-access):
 *   DATABASE_ADMIN_URL="postgresql://soe_admin:<pw>@<host>:5432/soe" \
 *     pnpm --filter @soe/api exec tsx scripts/cargar-informes-dia.ts <dirJson> [--confirm]
 *
 * Por defecto es DRY-RUN (upload + preview, NO persiste). `--confirm` ejecuta el confirm.
 *
 * Se EXCLUYEN los 8 de Lenguaje Intermedio (§9.3: ya tienen dato granular en demo; el
 * importador los rechazaría con 409 de todos modos).
 */
import 'reflect-metadata';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDbClient, type Database } from '@soe/db';
import type { JwtPayload } from '../src/auth/jwt-payload.types';
import { OfficialReportImportService } from '../src/official-report-import/official-report-import.service';
import { OfficialReportPreviewStore } from '../src/official-report-import/lib/preview-store';

const CSCJ_ORG = 'c5c10000-0000-0000-0000-000000000001';
const REPORT_YEAR = 2025;

// period del JSON → cómo se llama el instrumento en demo (por el nombre).
const PERIOD_LABEL: Record<string, string> = {
  diagnostico: 'Diagnóstico',
  intermedio: 'Intermedio',
  cierre: 'Cierre',
};
const SUBJECT_WORD: Record<string, string> = { LANG: 'Lectura', MATH: 'Matemática' };
const GRADE_WORD: Record<string, string> = {
  '3RD_BASIC': '3°',
  '4TH_BASIC': '4°',
  '5TH_BASIC': '5°',
  '6TH_BASIC': '6°',
};

type ReportDoc = {
  report: { subjectCode: string; gradeCode: string; period: string; courseLabel: string; year: number; studentCount: number };
  items: unknown[];
};

async function resolveImportUser(db: Database): Promise<JwtPayload> {
  // Un usuario real de CSCJ con rol de import (FK de import_jobs.created_by_id y
  // assessments.administered_by_id). Se prefiere school_admin / academic_director.
  const rows = await db.execute(sql`
    select u.id, u.email, u.name, om.role::text as role
    from users u
    join org_memberships om on om.user_id = u.id
    where om.org_id = ${CSCJ_ORG}
      and om.role in ('school_admin','academic_director','eval_coordinator','platform_admin')
      and u.deleted_at is null
    order by case om.role when 'school_admin' then 0 when 'academic_director' then 1 else 2 end
    limit 1
  `);
  const u = (rows as unknown as Array<{ id: string; email: string; name: string; role: string }>)[0];
  if (!u) throw new Error('No encontré un usuario de CSCJ con rol de import. Revisar org_memberships.');
  return {
    userId: u.id,
    orgId: CSCJ_ORG,
    email: u.email,
    name: u.name,
    isPlatformAdmin: false,
    roles: [u.role as JwtPayload['roles'][number]],
    activeRole: u.role as JwtPayload['activeRole'],
    role: u.role as JwtPayload['role'],
  };
}

async function buildInstrumentLookup(db: Database): Promise<Map<string, string>> {
  // (subjectCode|gradeCode|period) → instrumentId. Se matchea por nombre del instrumento
  // (contiene asignatura + grado + período) y se exige que sea oficial (org_id NULL).
  const rows = await db.execute(sql`
    select i.id, i.name, s.code as subject, g.code as grade
    from instruments i
    left join subjects s on s.id = i.subject_id
    left join grades g on g.id = i.grade_id
    where i.type = 'dia' and i.deleted_at is null and i.org_id is null
  `);
  const map = new Map<string, string>();
  for (const r of rows as unknown as Array<{ id: string; name: string; subject: string; grade: string }>) {
    map.set(`${r.subject}|${r.grade}|${r.name}`, r.id);
  }
  return map;
}

function findInstrument(lookup: Map<string, string>, subj: string, grade: string, period: string): string | null {
  const wantWord = PERIOD_LABEL[period];
  for (const [key, id] of lookup) {
    const [s, g, name] = key.split('|');
    if (s === subj && g === grade && name.includes(wantWord)) return id;
  }
  return null;
}

async function resolveClassGroup(db: Database, grade: string, courseLabel: string): Promise<string | null> {
  // courseLabel es "3 A" → letra final; el class group de CSCJ del año del informe.
  const letter = courseLabel.trim().slice(-1).toUpperCase();
  const rows = await db.execute(sql`
    select cg.id, cg.name
    from class_groups cg
    join grades g on g.id = cg.grade_id
    join academic_years ay on ay.id = cg.academic_year_id
    where cg.org_id = ${CSCJ_ORG} and g.code = ${grade} and ay.year = ${REPORT_YEAR}
  `);
  for (const r of rows as unknown as Array<{ id: string; name: string }>) {
    if (r.name.trim().toUpperCase().endsWith(letter)) return r.id;
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  const doConfirm = args.includes('--confirm');
  if (!dir) throw new Error('Falta el directorio con los JSON. Uso: ... cargar-informes-dia.ts <dir> [--confirm]');
  if (!process.env.DATABASE_ADMIN_URL) throw new Error('Falta DATABASE_ADMIN_URL (túnel a demo).');

  const db = createDbClient(process.env.DATABASE_ADMIN_URL);
  const service = new OfficialReportImportService(db, new OfficialReportPreviewStore());
  const user = await resolveImportUser(db);
  const instruments = await buildInstrumentLookup(db);
  console.log(`Usuario de import: ${user.name} (${user.activeRole}) · instrumentos DIA oficiales: ${instruments.size}`);
  console.log(doConfirm ? '\n=== MODO CONFIRM (persiste) ===\n' : '\n=== DRY-RUN (upload + preview, NO persiste) ===\n');

  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  let ok = 0, skipped = 0, failed = 0, confirmed = 0;

  for (const f of files) {
    const doc = JSON.parse(readFileSync(resolve(dir, f), 'utf-8')) as ReportDoc;
    const r = doc.report;
    const label = `${SUBJECT_WORD[r.subjectCode]} ${GRADE_WORD[r.gradeCode]} ${r.period} ${r.courseLabel}`;

    // §9.3: Lenguaje intermedio NO se importa (ya tiene granular).
    if (r.subjectCode === 'LANG' && r.period === 'intermedio') {
      console.log(`  ⏭️  ${label.padEnd(34)} — omitido (§9.3, ya granular en demo)`);
      skipped++;
      continue;
    }

    const instrumentId = findInstrument(instruments, r.subjectCode, r.gradeCode, r.period);
    if (!instrumentId) { console.log(`  ✗ ${label.padEnd(34)} — instrumento no encontrado en demo`); failed++; continue; }
    const classGroupId = await resolveClassGroup(db, r.gradeCode, r.courseLabel);
    if (!classGroupId) { console.log(`  ✗ ${label.padEnd(34)} — class group ${r.courseLabel} (${REPORT_YEAR}) no encontrado`); failed++; continue; }

    try {
      const up = await service.upload(user, { buffer: Buffer.from(JSON.stringify(doc)), originalname: f }, { instrumentId, classGroupId });
      const prev = await service.preview(user, up.previewToken);
      const blocking = prev.gates.filter((g) => g.blocking && g.status === 'failed');
      const warns = prev.gates.filter((g) => g.status === 'warning').map((g) => g.gate);

      if (blocking.length > 0) {
        console.log(`  ✗ ${label.padEnd(34)} — gates: ${blocking.map((g) => g.gate + ':' + g.message.slice(0, 40)).join(' | ')}`);
        failed++;
        continue;
      }

      if (doConfirm) {
        await service.confirm(user, { previewToken: up.previewToken, studentMatches: [] });
        confirmed++;
        console.log(`  ✓ ${label.padEnd(34)} — CONFIRMADO (N=${r.studentCount}, ${doc.items.length} ítems${warns.length ? ', warn: ' + warns.join(',') : ''})`);
      } else {
        console.log(`  ✓ ${label.padEnd(34)} — preview OK (N=${r.studentCount}, ${doc.items.length} ítems${warns.length ? ', warn: ' + warns.join(',') : ''})`);
      }
      ok++;
    } catch (e) {
      console.log(`  ✗ ${label.padEnd(34)} — ${(e as Error).message.slice(0, 90)}`);
      failed++;
    }
  }

  console.log(`\n=== ${ok} OK · ${confirmed} confirmados · ${skipped} omitidos (§9.3) · ${failed} con problemas (de ${files.length}) ===`);
  if (!doConfirm && failed === 0) console.log('Todo pasa el preview. Re-correr con --confirm para persistir.');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1); });
