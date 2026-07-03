// query.ts — ejemplo de acceso a la BDD demo. Requiere DATABASE_ADMIN_URL en el entorno
// (lo setea with-db.sh). Correr con:  pnpm --filter @soe/db exec tsx <ruta a este archivo>
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_ADMIN_URL as string, { max: 1 });

(async () => {
  // 1) LEER una tabla SIN RLS (orgs, users, org_memberships, platform_admins...):
  const orgs = await sql`select id, name, type from organizations order by name`;
  console.log('orgs:', orgs.map((o) => o.name).join(', '));

  // 2) LEER una tabla CON FORCE RLS (students, assessments, results...) como admin:
  //    hay que fijar el contexto de org, si no devuelve 0 filas.
  await sql`select set_config('app.current_org_id', 'c5c10000-0000-0000-0000-000000000001', false)`;
  const n = await sql`select count(*)::int as c from students`;
  console.log('alumnos CSCJ:', n[0].c);
  await sql`select set_config('app.current_org_id', '', false)`; // limpiar contexto

  // 3) ESCRIBIR en tablas SIN RLS (idempotente):
  //    await sql`update users set name = 'Nuevo' where email = 'x@y.cl'`;
  //
  // 4) ESCRIBIR en tablas CON FORCE RLS → ver SKILL.md §5 (withOrgContext o NO FORCE + db:migrate).

  await sql.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
