import {
  AUTO_MATCH_MIN_CONFIDENCE,
  matchReportName,
  normalizeName,
  similarity,
  type StudentForMatch,
} from './student-name-matcher';

const ROSTER: StudentForMatch[] = [
  { id: 'st-1', firstName: 'Camila Andrea', lastName: 'Arredondo Saballa' },
  { id: 'st-2', firstName: 'Benjamín', lastName: 'Muñoz Rojas' },
  { id: 'st-3', firstName: 'Sofía', lastName: 'Contreras Díaz' },
];

describe('normalizeName', () => {
  it('quita puntuación, tildes y colapsa espacios', () => {
    expect(normalizeName('  Arredondo   Saballa, C.  ')).toBe('ARREDONDO SABALLA C');
    expect(normalizeName('Sofía Contreras Díaz')).toBe('SOFIA CONTRERAS DIAZ');
  });

  it('convierte Ñ a N en ambos lados, así el OCR sin tilde cruza igual', () => {
    expect(normalizeName('Muñoz')).toBe(normalizeName('Munoz'));
  });
});

describe('similarity', () => {
  it('es 1 para strings idénticos y 0 contra el vacío', () => {
    expect(similarity('ABC', 'ABC')).toBe(1);
    expect(similarity('ABC', '')).toBe(0);
  });

  it('penaliza proporcionalmente a la distancia de edición', () => {
    expect(similarity('MUNOZ', 'MUNOS')).toBeCloseTo(0.8, 5);
  });
});

describe('matchReportName', () => {
  it('cruza el nombre abreviado del informe (apellidos + inicial)', () => {
    // Es el formato real de la figura de niveles: "ARREDONDO SABALLA C."
    const out = matchReportName('ARREDONDO SABALLA C.', ROSTER);
    expect(out.studentId).toBe('st-1');
    expect(out.confidence).toBe(1);
    expect(out.ambiguous).toBe(false);
  });

  it('tolera el OCR sin tildes', () => {
    const out = matchReportName('MUNOZ ROJAS B.', ROSTER);
    expect(out.studentId).toBe('st-2');
  });

  it('cruza el nombre completo en cualquier orden', () => {
    expect(matchReportName('Contreras Díaz Sofía', ROSTER).studentId).toBe('st-3');
    expect(matchReportName('Sofía Contreras Díaz', ROSTER).studentId).toBe('st-3');
  });

  it('tolera un error de lectura de una letra', () => {
    const out = matchReportName('ARREDONDO SABALLA G.', ROSTER);
    expect(out.studentId).toBe('st-1');
    expect(out.confidence).toBeGreaterThanOrEqual(AUTO_MATCH_MIN_CONFIDENCE);
    expect(out.confidence).toBeLessThan(1);
  });

  it('NO propone nada bajo el umbral, y lista los candidatos para el humano', () => {
    // Regla dura (§8.7): si no cruza, la fila queda fuera. Nunca se crea el alumno.
    const out = matchReportName('PERSONA INEXISTENTE X.', ROSTER);
    expect(out.studentId).toBeNull();
    expect(out.confidence).toBeLessThan(AUTO_MATCH_MIN_CONFIDENCE);
    expect(out.candidates.length).toBeGreaterThan(0);
  });

  it('marca ambiguo y no elige cuando dos alumnos empatan', () => {
    // Hermanos: mismos apellidos y misma inicial. Elegir uno sería escribir el nivel
    // sobre el alumno equivocado.
    const gemelos: StudentForMatch[] = [
      { id: 'g-1', firstName: 'Carlos', lastName: 'Soto Lara' },
      { id: 'g-2', firstName: 'Catalina', lastName: 'Soto Lara' },
    ];
    const out = matchReportName('SOTO LARA C.', gemelos);

    expect(out.ambiguous).toBe(true);
    expect(out.studentId).toBeNull();
    expect(out.candidates.map((c) => c.studentId).sort()).toEqual(['g-1', 'g-2']);
  });

  it('no rompe con nómina vacía ni nombre vacío', () => {
    expect(matchReportName('ARREDONDO SABALLA C.', []).studentId).toBeNull();
    expect(matchReportName('   ', ROSTER).studentId).toBeNull();
  });
});
