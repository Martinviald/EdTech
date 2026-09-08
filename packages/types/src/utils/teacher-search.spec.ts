import {
  MIN_TEACHER_QUERY_LENGTH,
  matchesTeacherQuery,
  normalizeForSearch,
} from './teacher-search';

const javiera = { name: 'Javiera González Pérez', email: 'jgonzalez@cscj.cl' };
const marcela = { name: 'Marcela Soto', email: 'msoto@cscj.cl' };
const gonzaloLopez = { name: 'Gonzalo López', email: 'glopez@cscj.cl' };

describe('normalizeForSearch', () => {
  it('baja a minúsculas y saca las tildes', () => {
    expect(normalizeForSearch('Javiera González Pérez')).toBe('javiera gonzalez perez');
  });

  it('deja la ñ como está (no es una tilde combinante)', () => {
    expect(normalizeForSearch('Muñoz')).toBe('munoz');
  });
});

describe('matchesTeacherQuery', () => {
  it('encuentra por prefijo de correo — el caso que motivó el fix', () => {
    expect(matchesTeacherQuery(javiera, 'jgonz')).toBe(true);
  });

  it('NO devuelve a quien no tiene nada que ver con la búsqueda', () => {
    expect(matchesTeacherQuery(marcela, 'jgonz')).toBe(false);
    // "gonzalo" comparte "gonz" con "gonzalez", pero "jgonz" no está en ninguno
    // de sus dos campos.
    expect(matchesTeacherQuery(gonzaloLopez, 'jgonz')).toBe(false);
  });

  it('encuentra por apellido con tilde escribiendo sin tilde', () => {
    expect(matchesTeacherQuery(javiera, 'gonzalez')).toBe(true);
    expect(matchesTeacherQuery(javiera, 'perez')).toBe(true);
  });

  it('acepta varios términos en cualquier orden', () => {
    expect(matchesTeacherQuery(javiera, 'javiera gonz')).toBe(true);
    expect(matchesTeacherQuery(javiera, 'gonz javiera')).toBe(true);
  });

  it('exige que TODOS los términos coincidan', () => {
    expect(matchesTeacherQuery(javiera, 'javiera soto')).toBe(false);
  });

  it('ignora mayúsculas y espacios sobrantes', () => {
    expect(matchesTeacherQuery(javiera, '  JAVIERA   gonz ')).toBe(true);
  });

  it('una búsqueda vacía no coincide con NADIE (sin búsqueda no hay resultados)', () => {
    expect(matchesTeacherQuery(javiera, '')).toBe(false);
    expect(matchesTeacherQuery(javiera, '   ')).toBe(false);
  });

  it('busca también en el nombre, no sólo en el correo', () => {
    expect(matchesTeacherQuery(marcela, 'marcela')).toBe(true);
  });

  it('el mínimo de caracteres para desplegar resultados es 2', () => {
    expect(MIN_TEACHER_QUERY_LENGTH).toBe(2);
  });
});
