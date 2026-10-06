import { PgDialect } from 'drizzle-orm/pg-core';
import { assessmentNameMatches } from './assessment-name-search.helper';

const dialect = new PgDialect();

function compile(term: string) {
  return dialect.sqlToQuery(assessmentNameMatches(term));
}

describe('assessmentNameMatches', () => {
  it('compara los dos nombres con OR, sin tildes y sin distinguir mayúsculas', () => {
    const { sql } = compile('matematica');

    expect(sql).toContain('"assessments"."name"');
    expect(sql).toContain('"instruments"."name"');
    expect(sql).toContain('ilike');
    expect(sql.match(/public\.unaccent/g)).toHaveLength(4);
    expect(sql).toContain(' or ');
  });

  it('el término viaja como parámetro vinculado, no interpolado', () => {
    const { sql, params } = compile("matematica'; drop table assessments; --");

    expect(sql).not.toContain('drop table');
    expect(params).toEqual([
      "%matematica'; drop table assessments; --%",
      "%matematica'; drop table assessments; --%",
    ]);
  });

  it('envuelve el término en comodines de "contiene"', () => {
    expect(compile('lectura').params).toEqual(['%lectura%', '%lectura%']);
  });

  it('escapa los comodines que el usuario escribe', () => {
    expect(compile('100%').params).toEqual(['%100\\%%', '%100\\%%']);
    expect(compile('a_b').params).toEqual(['%a\\_b%', '%a\\_b%']);
  });
});
