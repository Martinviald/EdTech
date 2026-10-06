import {
  indexTestTracksByCode,
  resolveTestTrack,
  TestTrackResolutionError,
  type TestTrackRef,
} from './test-tracks';
import { testTrackCatalogSchema } from '../schemas/test-track.schema';

const MATH = 'subject-math';
const SCI = 'subject-sci';
const ORG_A = 'org-a';
const ORG_B = 'org-b';

const M1: TestTrackRef = { id: 'track-m1', orgId: null, subjectId: MATH, code: 'M1' };
const M2: TestTrackRef = { id: 'track-m2', orgId: null, subjectId: MATH, code: 'M2' };
const BIO: TestTrackRef = { id: 'track-bio', orgId: null, subjectId: SCI, code: 'BIO' };
const PRIVATE_TALLER: TestTrackRef = {
  id: 'track-taller-a',
  orgId: ORG_A,
  subjectId: MATH,
  code: 'TALLER',
};
const PRIVATE_M1: TestTrackRef = { id: 'track-m1-a', orgId: ORG_A, subjectId: MATH, code: 'M1' };

const catalog = indexTestTracksByCode([M1, M2, BIO, PRIVATE_TALLER, PRIVATE_M1]);

const officialMath = { label: 'PAES M1 E1', subjectId: MATH, orgId: null };

describe('resolveTestTrack', () => {
  it('resuelve una línea oficial de la misma asignatura', () => {
    expect(resolveTestTrack('M2', officialMath, catalog).id).toBe('track-m2');
  });

  it('falla en seco si el código no existe', () => {
    expect(() => resolveTestTrack('M3', officialMath, catalog)).toThrow(TestTrackResolutionError);
    expect(() => resolveTestTrack('M3', officialMath, catalog)).toThrow(/no existe/);
  });

  it('falla si la línea es de otra asignatura', () => {
    expect(() => resolveTestTrack('BIO', officialMath, catalog)).toThrow(/otra asignatura/);
  });

  it('un instrumento oficial no puede apuntar a una línea privada', () => {
    expect(() => resolveTestTrack('TALLER', officialMath, catalog)).toThrow(/oficial/);
  });

  it('un instrumento oficial ignora la línea privada homónima y toma la oficial', () => {
    expect(resolveTestTrack('M1', officialMath, catalog).id).toBe('track-m1');
  });

  it('un instrumento privado usa su propia línea antes que la oficial homónima', () => {
    const owner = { label: 'Ensayo propio', subjectId: MATH, orgId: ORG_A };
    expect(resolveTestTrack('M1', owner, catalog).id).toBe('track-m1-a');
    expect(resolveTestTrack('TALLER', owner, catalog).id).toBe('track-taller-a');
  });

  it('un instrumento privado no ve las líneas privadas de otro colegio', () => {
    const owner = { label: 'Ensayo ajeno', subjectId: MATH, orgId: ORG_B };
    expect(() => resolveTestTrack('TALLER', owner, catalog)).toThrow(/no existe/);
    expect(resolveTestTrack('M1', owner, catalog).id).toBe('track-m1');
  });

  it('falla si el instrumento no tiene asignatura', () => {
    const owner = { label: 'Sin asignatura', subjectId: null, orgId: null };
    expect(() => resolveTestTrack('M1', owner, catalog)).toThrow(/asignatura/);
  });
});

describe('testTrackCatalogSchema', () => {
  const entry = {
    subjectCode: 'MATH',
    code: 'M1',
    name: 'Matemática 1',
    shortName: 'M1',
    order: 1,
  };

  it('acepta un catálogo válido', () => {
    expect(testTrackCatalogSchema.safeParse({ tracks: [entry] }).success).toBe(true);
  });

  it('rechaza un código repetido en la misma asignatura', () => {
    expect(testTrackCatalogSchema.safeParse({ tracks: [entry, entry] }).success).toBe(false);
  });

  it('permite el mismo código en otra asignatura', () => {
    const other = { ...entry, subjectCode: 'SCI' };
    expect(testTrackCatalogSchema.safeParse({ tracks: [entry, other] }).success).toBe(true);
  });

  it('rechaza códigos en minúsculas o con espacios', () => {
    expect(testTrackCatalogSchema.safeParse({ tracks: [{ ...entry, code: 'm 1' }] }).success).toBe(
      false,
    );
  });
});
