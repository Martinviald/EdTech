import { indexTestTracksByCode, type TestTrackRef } from '@soe/types';
import { resolveImportTracks, type InstrumentJson } from './import-instruments';

const MATH = 'subject-math';
const SCI = 'subject-sci';

const catalog = indexTestTracksByCode([
  { id: 'track-m1', orgId: null, subjectId: MATH, code: 'M1' },
  { id: 'track-m2', orgId: null, subjectId: MATH, code: 'M2' },
  { id: 'track-comun', orgId: null, subjectId: SCI, code: 'CIE-COMUN' },
  { id: 'track-bio', orgId: null, subjectId: SCI, code: 'BIO' },
  { id: 'track-fis', orgId: null, subjectId: SCI, code: 'FIS' },
  { id: 'track-privada', orgId: 'org-a', subjectId: MATH, code: 'TALLER' },
] satisfies TestTrackRef[]);

function doc(
  instrument: Partial<InstrumentJson['instrument']>,
  sections: Partial<InstrumentJson['sections'][number]>[] = [{}],
): InstrumentJson {
  return {
    instrument: {
      name: 'PAES M2 — Ensayo 3',
      subject: 'Matemática',
      subjectCode: 'MATH',
      grade: 'IV° Medio',
      gradeCode: '4TH_MEDIO',
      year: 2026,
      applicationPeriod: '',
      type: 'paes',
      ...instrument,
    },
    sections: sections.map((section, index) => ({
      order: index,
      name: `Sección ${index + 1}`,
      type: 'multiple_choice',
      items: [],
      ...section,
    })),
  };
}

const officialMath = { subjectId: MATH, orgId: null };
const officialSci = { subjectId: SCI, orgId: null };

describe('resolveImportTracks', () => {
  it('sin track el instrumento y sus secciones quedan sin línea', () => {
    expect(resolveImportTracks(doc({}), officialMath, catalog)).toEqual({
      instrumentTrackId: null,
      sectionTrackIds: [null],
    });
  });

  it('resuelve la línea del instrumento por código', () => {
    const resolved = resolveImportTracks(doc({ track: 'M2' }), officialMath, catalog);
    expect(resolved.instrumentTrackId).toBe('track-m2');
  });

  it('falla en seco si el código no existe en el catálogo', () => {
    expect(() => resolveImportTracks(doc({ track: 'M3' }), officialMath, catalog)).toThrow(
      /no existe/,
    );
  });

  it('falla si la línea es de otra asignatura', () => {
    expect(() => resolveImportTracks(doc({ track: 'BIO' }), officialMath, catalog)).toThrow(
      /otra asignatura/,
    );
  });

  it('un instrumento oficial no puede apuntar a una línea privada', () => {
    expect(() => resolveImportTracks(doc({ track: 'TALLER' }), officialMath, catalog)).toThrow(
      /oficial/,
    );
  });

  it('resuelve las líneas de las secciones electivas', () => {
    const ciencias = doc({ name: 'PAES CIE — Ensayo 3', subjectCode: 'SCI', track: 'CIE-COMUN' }, [
      {},
      { role: 'elective', electiveGroup: 'mencion', electiveKey: 'BIO', track: 'BIO' },
      { role: 'elective', electiveGroup: 'mencion', electiveKey: 'FIS', track: 'FIS' },
    ]);
    expect(resolveImportTracks(ciencias, officialSci, catalog)).toEqual({
      instrumentTrackId: 'track-comun',
      sectionTrackIds: [null, 'track-bio', 'track-fis'],
    });
  });

  it('rechaza una sección electiva sin línea', () => {
    const ciencias = doc({ subjectCode: 'SCI' }, [
      {},
      { role: 'elective', electiveGroup: 'mencion', electiveKey: 'BIO' },
    ]);
    expect(() => resolveImportTracks(ciencias, officialSci, catalog)).toThrow(/línea de prueba/);
  });

  it('rechaza una línea en una sección core', () => {
    expect(() => resolveImportTracks(doc({}, [{ track: 'M1' }]), officialMath, catalog)).toThrow(
      /core/,
    );
  });

  it('rechaza una sección electiva con línea de otra asignatura', () => {
    const matematica = doc({}, [
      {},
      { role: 'elective', electiveGroup: 'g', electiveKey: 'BIO', track: 'BIO' },
    ]);
    expect(() => resolveImportTracks(matematica, officialMath, catalog)).toThrow(/otra asignatura/);
  });
});
