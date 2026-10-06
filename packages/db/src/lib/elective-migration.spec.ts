import {
  assignStudentForms,
  buildItemRemap,
  computeResultsFromResponses,
  diffStudentOutcomes,
  groupLegacyAssessments,
  parseElectiveMigrationMap,
  reverseKey,
  unionTagsForFusedItems,
  type MapItemEntry,
  type ScoredResponseRow,
  type StudentOutcome,
} from './elective-migration';

const entry = (
  electiveKey: string,
  legacyPrintedNumber: string,
  fusedElectiveKey: string | null,
  fusedPrintedNumber: string,
): MapItemEntry => ({ electiveKey, legacyPrintedNumber, fusedElectiveKey, fusedPrintedNumber });

describe('parseElectiveMigrationMap', () => {
  const valid = {
    loadKey: 'lote',
    instruments: [
      {
        fused: { sourceJson: 'F.json', file: 'X/F.json' },
        legacy: [
          { sourceJson: 'A.json', electiveKey: 'A' },
          { sourceJson: 'B.json', electiveKey: 'B' },
        ],
        items: [
          entry('A', '1', null, '1'),
          { ...entry('B', '3', 'B', '3'), legacyPrintedNumber: 3 },
        ],
      },
    ],
  };

  it('acepta un mapa válido y normaliza los números impresos a texto', () => {
    const parsed = parseElectiveMigrationMap(valid);
    expect(parsed.loadKey).toBe('lote');
    expect(parsed.instruments[0]!.items[1]!.legacyPrintedNumber).toBe('3');
  });

  it('rechaza una clave de rama repetida entre los legacy', () => {
    const repeated = {
      ...valid,
      instruments: [
        {
          ...valid.instruments[0]!,
          legacy: [valid.instruments[0]!.legacy[0], valid.instruments[0]!.legacy[0]],
        },
      ],
    };
    expect(() => parseElectiveMigrationMap(repeated)).toThrow('repite una electiveKey');
  });

  it('rechaza mandar un ítem de una rama a la sección de otra', () => {
    const crossed = {
      ...valid,
      instruments: [{ ...valid.instruments[0]!, items: [entry('A', '60', 'B', '60')] }],
    };
    expect(() => parseElectiveMigrationMap(crossed)).toThrow('a la rama B');
  });

  it('rechaza un ítem cuya rama no tiene instrumento legacy', () => {
    const orphan = {
      ...valid,
      instruments: [{ ...valid.instruments[0]!, items: [entry('Z', '1', null, '1')] }],
    };
    expect(() => parseElectiveMigrationMap(orphan)).toThrow('sin legacy');
  });
});

describe('buildItemRemap', () => {
  const fused = [
    { id: 'c1', electiveKey: null, printedNumber: '1' },
    { id: 'c2', electiveKey: null, printedNumber: '2' },
    { id: 'a55', electiveKey: 'A', printedNumber: '55' },
    { id: 'b55', electiveKey: 'B', printedNumber: '55' },
  ];
  const entries = [
    entry('A', '1', null, '1'),
    entry('A', '2', null, '2'),
    entry('A', '55', 'A', '55'),
    entry('B', '1', null, '2'),
    entry('B', '2', null, '1'),
    entry('B', '55', 'B', '55'),
  ];

  it('empareja el común aunque esté en otro orden en otra rama y lo puede deshacer', () => {
    const legacy = [
      { id: 'la1', electiveKey: 'A', printedNumber: '1' },
      { id: 'lb1', electiveKey: 'B', printedNumber: '1' },
      { id: 'lb2', electiveKey: 'B', printedNumber: '2' },
      { id: 'lb55', electiveKey: 'B', printedNumber: '55' },
    ];
    const remap = buildItemRemap(entries, legacy, fused);
    expect(remap.errors).toEqual([]);
    expect(remap.forward.get('lb1')).toBe('c2');
    expect(remap.forward.get('lb2')).toBe('c1');
    expect(remap.forward.get('lb55')).toBe('b55');
    expect(remap.reverse.get(reverseKey('B', 'c1'))).toBe('lb2');
    expect(remap.reverse.get(reverseKey('A', 'c1'))).toBe('la1');
  });

  it('las ramas distintas que comparten un ítem común no chocan entre sí', () => {
    const legacy = [
      { id: 'la1', electiveKey: 'A', printedNumber: '1' },
      { id: 'lb2', electiveKey: 'B', printedNumber: '2' },
    ];
    const remap = buildItemRemap(entries, legacy, fused);
    expect(remap.errors).toEqual([]);
    expect(remap.forward.get('la1')).toBe(remap.forward.get('lb2'));
  });

  it('reporta un ítem legacy sin entrada y un destino inexistente', () => {
    const legacy = [
      { id: 'x', electiveKey: 'A', printedNumber: '99' },
      { id: 'y', electiveKey: 'A', printedNumber: '55' },
    ];
    const remap = buildItemRemap(entries, legacy, fused.slice(0, 2));
    expect(remap.errors).toHaveLength(2);
    expect(remap.errors[0]).toContain('sin entrada');
    expect(remap.errors[1]).toContain('no existe el destino');
  });

  it('reporta dos ítems de la misma rama que van al mismo destino', () => {
    const legacy = [
      { id: 'p', electiveKey: 'A', printedNumber: '1' },
      { id: 'q', electiveKey: 'A', printedNumber: '2' },
    ];
    const remap = buildItemRemap(
      [entry('A', '1', null, '1'), entry('A', '2', null, '1')],
      legacy,
      fused,
    );
    expect(remap.errors).toEqual([expect.stringContaining('mismo destino')]);
  });
});

describe('assignStudentForms', () => {
  it('asigna la rama de la evaluación donde el alumno tiene respuestas', () => {
    const result = assignStudentForms([
      { studentId: 's1', electiveKey: 'A' },
      { studentId: 's1', electiveKey: 'A' },
      { studentId: 's2', electiveKey: 'B' },
    ]);
    expect(result.conflicts).toEqual([]);
    expect(result.byStudent).toEqual(
      new Map([
        ['s1', 'A'],
        ['s2', 'B'],
      ]),
    );
  });

  it('marca conflicto si el alumno tiene respuestas en dos ramas', () => {
    const result = assignStudentForms([
      { studentId: 's1', electiveKey: 'A' },
      { studentId: 's1', electiveKey: 'B' },
    ]);
    expect(result.byStudent.size).toBe(0);
    expect(result.conflicts).toEqual([{ studentId: 's1', electiveKeys: ['A', 'B'] }]);
  });

  it('marca conflicto si la rama nueva no coincide con la ya asignada', () => {
    const result = assignStudentForms(
      [{ studentId: 's1', electiveKey: 'B' }],
      new Map([['s1', 'A']]),
    );
    expect(result.conflicts).toEqual([{ studentId: 's1', electiveKeys: ['A', 'B'] }]);
  });

  it('respeta las asignaciones previas sin respuestas nuevas', () => {
    const result = assignStudentForms([], new Map([['s1', 'A']]));
    expect(result.byStudent.get('s1')).toBe('A');
  });
});

describe('groupLegacyAssessments', () => {
  const info = new Map([
    ['iA', { fusedSourceJson: 'F', electiveKey: 'A' }],
    ['iB', { fusedSourceJson: 'F', electiveKey: 'B' }],
  ]);

  it('agrupa por instrumento fusionado y curso', () => {
    const { groups, errors } = groupLegacyAssessments(
      [
        { id: 'a1', instrumentId: 'iA', classGroupIds: ['c1'] },
        { id: 'b1', instrumentId: 'iB', classGroupIds: ['c1'] },
        { id: 'a2', instrumentId: 'iA', classGroupIds: ['c2'] },
      ],
      info,
    );
    expect(errors).toEqual([]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.legacyByKey).toEqual(
      new Map([
        ['A', 'a1'],
        ['B', 'b1'],
      ]),
    );
  });

  it('reporta una evaluación sin curso único y una rama repetida en el mismo curso', () => {
    const { errors } = groupLegacyAssessments(
      [
        { id: 'a1', instrumentId: 'iA', classGroupIds: [] },
        { id: 'a2', instrumentId: 'iA', classGroupIds: ['c1'] },
        { id: 'a3', instrumentId: 'iA', classGroupIds: ['c1'] },
        { id: 'z', instrumentId: 'otro', classGroupIds: ['c1'] },
      ],
      info,
    );
    expect(errors).toHaveLength(3);
  });
});

describe('computeResultsFromResponses', () => {
  const row = (
    studentId: string,
    itemId: string,
    isCorrect: boolean | null,
    rawScore: number | null,
  ): ScoredResponseRow => ({
    studentId,
    itemId,
    value: { answer: 'A' },
    hasAlternatives: true,
    isCorrect,
    rawScore,
    finalScore: rawScore,
    maxScore: 1,
    itemPosition: 1,
    taxonomyNodeIds: ['n1'],
  });

  it('deja los pendientes fuera del total y marca al alumno con pendientes', () => {
    const result = computeResultsFromResponses([
      row('s1', 'i1', true, 1),
      row('s1', 'i2', false, 0),
      row('s1', 'i3', null, null),
    ]);
    expect(result.students).toHaveLength(1);
    expect(result.students[0]!.totalScore).toBe(1);
    expect(result.students[0]!.maxScore).toBe(2);
    expect(result.students[0]!.percentage).toBe(0.5);
    expect(result.studentsWithPending.has('s1')).toBe(true);
    expect(result.calc).toHaveLength(3);
  });

  it('da el mismo resultado sin importar a qué ítem apunte cada respuesta', () => {
    const a = computeResultsFromResponses([row('s1', 'i1', true, 1), row('s1', 'i2', false, 0)]);
    const b = computeResultsFromResponses([row('s1', 'x9', true, 1), row('s1', 'x8', false, 0)]);
    expect(b.students).toEqual(a.students);
  });
});

describe('diffStudentOutcomes', () => {
  const outcome = (percentage: string): StudentOutcome => ({
    scoreSum: 10,
    maxSum: 20,
    percentage,
    grade: '3.50',
    isComplete: true,
  });

  it('no reporta nada cuando los resultados coinciden', () => {
    expect(
      diffStudentOutcomes(new Map([['s1', outcome('50.00')]]), new Map([['s1', outcome('50.00')]])),
    ).toEqual([]);
  });

  it('reporta cambios, faltantes y sobrantes', () => {
    const diffs = diffStudentOutcomes(
      new Map([
        ['s1', outcome('50.00')],
        ['s2', outcome('10.00')],
      ]),
      new Map([
        ['s1', outcome('51.00')],
        ['s3', outcome('10.00')],
      ]),
    );
    expect(diffs).toHaveLength(3);
  });
});

describe('unionTagsForFusedItems', () => {
  it('une los tags de las copias y deja primary cuando alguna lo es', () => {
    const forward = new Map([
      ['la1', 'c1'],
      ['lb2', 'c1'],
      ['la55', 'a55'],
    ]);
    const tags = unionTagsForFusedItems(forward, [
      { itemId: 'la1', nodeId: 'n1', tagType: 'secondary' },
      { itemId: 'lb2', nodeId: 'n1', tagType: 'primary' },
      { itemId: 'lb2', nodeId: 'n2', tagType: 'secondary' },
      { itemId: 'la55', nodeId: 'n3', tagType: 'primary' },
      { itemId: 'otro', nodeId: 'n4', tagType: 'primary' },
    ]);
    expect(tags.get('c1')).toEqual(
      new Map([
        ['n1', 'primary'],
        ['n2', 'secondary'],
      ]),
    );
    expect(tags.get('a55')).toEqual(new Map([['n3', 'primary']]));
    expect(tags.size).toBe(2);
  });
});
