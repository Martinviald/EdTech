import {
  DEFAULT_GRADING_SCALE,
  DEFAULT_PERFORMANCE_THRESHOLDS,
  aggregateSkillResults,
  aggregateStudentResults,
  isPassingGrade,
  percentageToGrade,
  percentageToPerformanceLevel,
  type GradingScaleParams,
  type ResponseForCalculation,
} from './grade-calculator';

// Escala DIA canónica: 1.0–7.0, aprobación 60% → 4.0, 4 niveles default.
const DIA_SCALE: GradingScaleParams = {
  type: 'linear_chilean',
  minGrade: 1,
  maxGrade: 7,
  passingGrade: 4,
  passingThreshold: 0.6,
};

/** Construye una respuesta MCQ DIA (maxScore 1, raw 0/1). */
function diaResponse(
  studentId: string,
  itemId: string,
  position: number,
  correct: boolean,
  nodeIds: string[] = ['node-a'],
): ResponseForCalculation {
  return {
    studentId,
    itemId,
    isCorrect: correct,
    rawScore: correct ? 1 : 0,
    maxScore: 1,
    itemPosition: position,
    taxonomyNodeIds: nodeIds,
  };
}

describe('grade-calculator — golden DIA (cero regresión)', () => {
  // GOLDEN: un instrumento DIA (MCQ, linear_chilean, 4 niveles) debe producir
  // EXACTAMENTE el mismo totalScore/percentage/grade/performanceLevel que antes
  // del cambio. 10 ítems, 7 correctos → 70% → adecuado → nota ~4.75.
  const responses: ResponseForCalculation[] = Array.from({ length: 10 }, (_, i) =>
    diaResponse('stu-1', `item-${i}`, i + 1, i < 7),
  );

  it('agrega totales DIA idénticos al comportamiento previo', () => {
    const [r] = aggregateStudentResults(responses, DIA_SCALE);
    expect(r).toBeDefined();
    expect(r!.totalScore).toBe(7);
    expect(r!.maxScore).toBe(10);
    expect(r!.percentage).toBeCloseTo(0.7, 10);
    // 0.70 con quiebre en 0.6: ratio (0.7-0.6)/(1-0.6)=0.25 → 4 + 0.25*3 = 4.75,
    // redondeado a 1 decimal (Math.round(47.5)/10) = 4.8 (golden, sin cambios).
    expect(r!.grade).toBe(4.8);
    expect(r!.performanceLevel).toBe('adequate'); // 0.70 ∈ [0.70, 0.85)
    expect(r!.isComplete).toBe(true);
  });

  it('los campos nuevos son nulos para escala porcentual/chilena (no rompe DIA)', () => {
    const [r] = aggregateStudentResults(responses, DIA_SCALE);
    expect(r!.scaledScore).toBeNull();
    expect(r!.bandLabel).toBeNull();
  });

  it('skill_results DIA: % por conteo == % ponderado (maxScore 1 por ítem)', () => {
    const skills = aggregateSkillResults(responses);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.correctCount).toBe(7);
    expect(skills[0]!.totalCount).toBe(10);
    expect(skills[0]!.percentage).toBeCloseTo(0.7, 10);
    expect(skills[0]!.performanceLevel).toBe('adequate');
  });
});

describe('aggregateStudentResults — ítems pendientes no contaminan el % (fuente única)', () => {
  // Instrumento MIXTO: 2 MCQ auto-corregidos (1 correcto) + 1 ítem pendiente
  // (no auto-corregible: isCorrect/rawScore/finalScore null, maxScore 5). El
  // pendiente NO debe contar en numerador ni denominador → % = 1/2 = 50%, e
  // isComplete = false. Cubre el hallazgo de auditoría: ambos consumidores
  // (ingesta y recálculo) deben coincidir sin replicar el filtro.
  const mixed: ResponseForCalculation[] = [
    { studentId: 'stu-1', itemId: 'mc-1', isCorrect: true, rawScore: 1, maxScore: 1, itemPosition: 1, taxonomyNodeIds: [] },
    { studentId: 'stu-1', itemId: 'mc-2', isCorrect: false, rawScore: 0, maxScore: 1, itemPosition: 2, taxonomyNodeIds: [] },
    { studentId: 'stu-1', itemId: 'open-1', isCorrect: null, rawScore: null, finalScore: null, maxScore: 5, itemPosition: 3, taxonomyNodeIds: [] },
  ];

  it('excluye el pendiente del % (su maxScore 5 no diluye el denominador)', () => {
    const [r] = aggregateStudentResults(mixed, DIA_SCALE);
    expect(r!.totalScore).toBe(1);
    expect(r!.maxScore).toBe(2); // 1+1; el maxScore 5 del pendiente NO se suma
    expect(r!.percentage).toBeCloseTo(0.5, 10);
    expect(r!.isComplete).toBe(false);
  });

  it('mismo % pasando todas las respuestas o solo las corregidas (rutas consistentes)', () => {
    const scoredOnly = mixed.filter((r) => r.isCorrect !== null);
    const withPending = aggregateStudentResults(mixed, DIA_SCALE)[0]!;
    const preFiltered = aggregateStudentResults(scoredOnly, DIA_SCALE)[0]!;
    expect(withPending.percentage).toBeCloseTo(preFiltered.percentage, 10);
    expect(withPending.totalScore).toBe(preFiltered.totalScore);
    expect(withPending.maxScore).toBe(preFiltered.maxScore);
    expect(withPending.isComplete).toBe(false); // con pendiente
    expect(preFiltered.isComplete).toBe(true); // sin pendiente
  });
});

describe('percentageToGrade — linear_chilean y percentage', () => {
  it('linear_chilean: 0% → minGrade, 100% → maxGrade, threshold → passingGrade', () => {
    expect(percentageToGrade(0, DIA_SCALE)).toBe(1);
    expect(percentageToGrade(1, DIA_SCALE)).toBe(7);
    expect(percentageToGrade(0.6, DIA_SCALE)).toBe(4);
  });

  it('percentage: devuelve % * 100', () => {
    const scale: GradingScaleParams = { ...DIA_SCALE, type: 'percentage' };
    expect(percentageToGrade(0.83, scale)).toBe(83);
  });

  it('usa DEFAULT_GRADING_SCALE como fallback razonable', () => {
    expect(percentageToGrade(0.6, DEFAULT_GRADING_SCALE)).toBe(4);
  });
});

describe('percentageToGrade — paes_scaled (#6)', () => {
  it('interpola por anchors leídos de config (PAES 150–1000)', () => {
    const scale: GradingScaleParams = {
      type: 'paes_scaled',
      minGrade: 150,
      maxGrade: 1000,
      passingGrade: 450,
      passingThreshold: 0.5,
      config: {
        anchors: [
          { p: 0, score: 150 },
          { p: 0.5, score: 575 },
          { p: 1, score: 1000 },
        ],
      },
    };
    expect(percentageToGrade(0, scale)).toBe(150);
    expect(percentageToGrade(0.5, scale)).toBe(575);
    expect(percentageToGrade(1, scale)).toBe(1000);
    // Interpolación entre anchors: 0.25 → punto medio de [150,575] = 362.5.
    expect(percentageToGrade(0.25, scale)).toBe(362.5);
  });

  it('usa min/maxScore lineal cuando no hay anchors', () => {
    const scale: GradingScaleParams = {
      type: 'paes_scaled',
      minGrade: 150,
      maxGrade: 1000,
      passingGrade: 450,
      passingThreshold: 0.5,
      config: { minScore: 100, maxScore: 200 },
    };
    expect(percentageToGrade(0.5, scale)).toBe(150);
  });

  it('cae a linear_chilean si la config de escalado falta (fallback documentado)', () => {
    const scale: GradingScaleParams = { ...DIA_SCALE, type: 'paes_scaled', config: null };
    // Sin config → mismo resultado que linear_chilean.
    expect(percentageToGrade(0.6, scale)).toBe(percentageToGrade(0.6, DIA_SCALE));
  });
});

describe('percentageToGrade — irt_based (#6)', () => {
  it('mapea el % vía logit a mean + θ·sd de config', () => {
    const scale: GradingScaleParams = {
      type: 'irt_based',
      minGrade: 0,
      maxGrade: 1000,
      passingGrade: 500,
      passingThreshold: 0.5,
      config: { mean: 500, sd: 100 },
    };
    // p = 0.5 → logit(0.5) = 0 → θ = 0 → score = mean = 500.
    expect(percentageToGrade(0.5, scale)).toBe(500);
    // p > 0.5 → score > mean ; p < 0.5 → score < mean (monótono).
    expect(percentageToGrade(0.75, scale)).toBeGreaterThan(500);
    expect(percentageToGrade(0.25, scale)).toBeLessThan(500);
  });

  it('respeta minScore/maxScore (recorte)', () => {
    const scale: GradingScaleParams = {
      type: 'irt_based',
      minGrade: 0,
      maxGrade: 1000,
      passingGrade: 500,
      passingThreshold: 0.5,
      config: { mean: 500, sd: 1000, minScore: 100, maxScore: 900 },
    };
    expect(percentageToGrade(0.99, scale)).toBeLessThanOrEqual(900);
    expect(percentageToGrade(0.01, scale)).toBeGreaterThanOrEqual(100);
  });

  it('cae a linear_chilean si falta mean/sd', () => {
    const scale: GradingScaleParams = { ...DIA_SCALE, type: 'irt_based', config: {} };
    expect(percentageToGrade(0.6, scale)).toBe(percentageToGrade(0.6, DIA_SCALE));
  });
});

describe('percentageToPerformanceLevel — thresholds y constante central', () => {
  it('usa los defaults 0.4/0.7/0.85 centralizados', () => {
    expect(DEFAULT_PERFORMANCE_THRESHOLDS).toEqual({
      elementary: 0.4,
      adequate: 0.7,
      advanced: 0.85,
    });
    expect(percentageToPerformanceLevel(0.3)).toBe('insufficient');
    expect(percentageToPerformanceLevel(0.5)).toBe('elementary');
    expect(percentageToPerformanceLevel(0.75)).toBe('adequate');
    expect(percentageToPerformanceLevel(0.9)).toBe('advanced');
  });

  it('respeta thresholds custom (heatmap con escala no-DIA)', () => {
    const custom = { performanceThresholds: { elementary: 0.3, adequate: 0.6, advanced: 0.8 } };
    // Con custom, 0.65 ∈ [0.6, 0.8) → 'adequate'. Con defaults (0.4/0.7/0.85),
    // 0.65 ∈ [0.4, 0.7) → 'elementary'. Esto prueba que los thresholds custom
    // efectivamente cambian la clasificación (caso heatmap escala no-DIA).
    expect(percentageToPerformanceLevel(0.65, custom)).toBe('adequate');
    expect(percentageToPerformanceLevel(0.65)).toBe('elementary');
  });

  it('lee thresholds desde config.performanceThresholds', () => {
    const scale = { config: { performanceThresholds: { adequate: 0.6 } } };
    expect(percentageToPerformanceLevel(0.62, scale)).toBe('adequate');
  });
});

describe('aggregateStudentResults — métrica raíz extendida (#3)', () => {
  it('expone scaledScore para escalas paes_scaled', () => {
    const scale: GradingScaleParams = {
      type: 'paes_scaled',
      minGrade: 150,
      maxGrade: 1000,
      passingGrade: 450,
      passingThreshold: 0.5,
      config: {
        anchors: [
          { p: 0, score: 150 },
          { p: 1, score: 1000 },
        ],
      },
    };
    const responses = [
      diaResponse('stu-1', 'i1', 1, true),
      diaResponse('stu-1', 'i2', 2, false),
    ];
    const [r] = aggregateStudentResults(responses, scale);
    expect(r!.percentage).toBeCloseTo(0.5, 10);
    expect(r!.scaledScore).toBe(575); // punto medio de [150,1000]
    expect(r!.grade).toBe(575);
  });

  it('deriva bandLabel desde config.bands (Cambridge-like)', () => {
    const scale: GradingScaleParams = {
      type: 'percentage',
      minGrade: 0,
      maxGrade: 100,
      passingGrade: 50,
      passingThreshold: 0.5,
      config: {
        bands: [
          { label: 'A1', minThreshold: 0 },
          { label: 'A2', minThreshold: 0.4 },
          { label: 'B1', minThreshold: 0.7 },
        ],
      },
    };
    const responses = Array.from({ length: 10 }, (_, i) =>
      diaResponse('stu-1', `i${i}`, i + 1, i < 8),
    );
    const [r] = aggregateStudentResults(responses, scale); // 80% → B1
    expect(r!.bandLabel).toBe('B1');
  });
});

describe('aggregateSkillResults — ponderación por maxScore y finalScore (#7/#9)', () => {
  it('pondera por maxScore por ítem (no conteo binario)', () => {
    // Ítem 1: maxScore 4, raw 4 (todo). Ítem 2: maxScore 1, raw 0.
    // Conteo binario daría 1/2 = 50%. Ponderado: 4/5 = 80%.
    const responses: ResponseForCalculation[] = [
      {
        studentId: 's',
        itemId: 'i1',
        isCorrect: true,
        rawScore: 4,
        maxScore: 4,
        itemPosition: 1,
        taxonomyNodeIds: ['n'],
      },
      {
        studentId: 's',
        itemId: 'i2',
        isCorrect: false,
        rawScore: 0,
        maxScore: 1,
        itemPosition: 2,
        taxonomyNodeIds: ['n'],
      },
    ];
    const [r] = aggregateSkillResults(responses);
    expect(r!.percentage).toBeCloseTo(0.8, 10);
    expect(r!.correctCount).toBe(1);
    expect(r!.totalCount).toBe(2);
  });

  it('respeta finalScore sobre rawScore (override humano cuenta)', () => {
    const responses: ResponseForCalculation[] = [
      {
        studentId: 's',
        itemId: 'i1',
        isCorrect: true,
        rawScore: 2, // IA dio 2
        finalScore: 5, // humano corrigió a 5
        maxScore: 5,
        itemPosition: 1,
        taxonomyNodeIds: ['n'],
      },
    ];
    const [r] = aggregateSkillResults(responses);
    expect(r!.percentage).toBeCloseTo(1, 10); // 5/5, no 2/5
  });

  it('finalScore precede a rawScore también en el total del alumno', () => {
    const responses: ResponseForCalculation[] = [
      {
        studentId: 's',
        itemId: 'i1',
        isCorrect: true,
        rawScore: 2,
        finalScore: 5,
        maxScore: 5,
        itemPosition: 1,
        taxonomyNodeIds: ['n'],
      },
    ];
    const [r] = aggregateStudentResults(responses, DIA_SCALE);
    expect(r!.totalScore).toBe(5);
    expect(r!.percentage).toBeCloseTo(1, 10);
  });

  it('ítems pendientes (isCorrect null) no contaminan el % de habilidad', () => {
    // 1 ítem MCQ correcto (4/4 puntos) + 1 ítem open_ended pendiente (null).
    const responses: ResponseForCalculation[] = [
      {
        studentId: 's',
        itemId: 'mcq',
        isCorrect: true,
        rawScore: 4,
        maxScore: 4,
        itemPosition: 1,
        taxonomyNodeIds: ['n'],
      },
      {
        studentId: 's',
        itemId: 'open',
        isCorrect: null,
        rawScore: null,
        finalScore: null,
        maxScore: 6,
        itemPosition: 2,
        taxonomyNodeIds: ['n'],
      },
    ];
    const [r] = aggregateSkillResults(responses);
    // El pendiente se excluye del denominador: 4/4 = 100%, no 4/10.
    expect(r!.percentage).toBeCloseTo(1, 10);
    expect(r!.totalCount).toBe(2); // conteo de ítems sigue contando ambos
    expect(r!.correctCount).toBe(1);
  });
});

describe('isPassingGrade', () => {
  it('aprueba con nota >= passingGrade', () => {
    expect(isPassingGrade(4, DIA_SCALE)).toBe(true);
    expect(isPassingGrade(3.9, DIA_SCALE)).toBe(false);
  });
});
