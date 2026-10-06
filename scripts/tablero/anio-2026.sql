-- Año 2026 de CSCJ en la BDD local de pruebas: promueve la nómina 2025 un grado
-- (misma sección) y matricula IV° medio desde la nómina 2026 real. Idempotente.
-- Uso: psql -f anio-2026.sql < roster-iv-2026.csv
\set ON_ERROR_STOP on
\set org '''c5c10000-0000-0000-0000-000000000001'''
\set year_id '''c5c10000-0000-0000-0000-000000002026'''

begin;

insert into academic_years (id, org_id, year, start_date, end_date, is_current)
values (:year_id, :org, 2026, '2026-03-01', '2026-12-31', true)
on conflict (id) do nothing;

update academic_years set is_current = (year = 2026) where org_id = :org;

create temp table roster_iv (
  rut text, first_name text, last_name text, gender text, birth_date date,
  grade_code text, section text
) on commit drop;
\copy roster_iv from pstdin with (format csv, header true)

create temp table promotion on commit drop as
select g.id as from_grade_id, g.code as from_code,
  (select n.id from grades n where n."order" > g."order" order by n."order" limit 1) as to_grade_id
from grades g;

create temp table target_groups on commit drop as
select distinct p.to_grade_id as grade_id, cg.name
from class_groups cg
join academic_years ay on ay.id = cg.academic_year_id and ay.year = 2025
join promotion p on p.from_grade_id = cg.grade_id
where cg.org_id = :org and p.to_grade_id is not null
  and p.from_code not in ('3RD_MEDIO', '4TH_MEDIO')
union
select distinct g.id, r.section
from roster_iv r join grades g on g.code = r.grade_code;

insert into class_groups (org_id, academic_year_id, grade_id, name)
select :org, :year_id, t.grade_id, t.name
from target_groups t
where not exists (
  select 1 from class_groups cg
  where cg.org_id = :org and cg.academic_year_id = :year_id
    and cg.grade_id = t.grade_id and cg.name = t.name
);

insert into students (org_id, rut, first_name, last_name, gender, birth_date)
select :org, r.rut, r.first_name, r.last_name, r.gender::gender, r.birth_date
from roster_iv r
on conflict (org_id, rut) do nothing;

insert into student_enrollments (student_id, class_group_id, academic_year_id, status)
select e.student_id, cg26.id, :year_id, 'active'
from student_enrollments e
join class_groups cg25 on cg25.id = e.class_group_id
join academic_years ay on ay.id = e.academic_year_id and ay.year = 2025
join promotion p on p.from_grade_id = cg25.grade_id
join class_groups cg26 on cg26.org_id = :org and cg26.academic_year_id = :year_id
  and cg26.grade_id = p.to_grade_id and cg26.name = cg25.name
where cg25.org_id = :org and e.status = 'active'
  and p.from_code not in ('3RD_MEDIO', '4TH_MEDIO')
on conflict (student_id, academic_year_id)
do update set class_group_id = excluded.class_group_id, status = 'active';

insert into student_enrollments (student_id, class_group_id, academic_year_id, status)
select s.id, cg.id, :year_id, 'active'
from roster_iv r
join students s on s.org_id = :org and s.rut = r.rut
join grades g on g.code = r.grade_code
join class_groups cg on cg.org_id = :org and cg.academic_year_id = :year_id
  and cg.grade_id = g.id and cg.name = r.section
on conflict (student_id, academic_year_id)
do update set class_group_id = excluded.class_group_id, status = 'active';

commit;
