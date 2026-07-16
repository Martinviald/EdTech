import type { OfficialReportGate, OfficialReportGateResult } from '@soe/types';
import { evaluateGates, resolveLevelBand, type GateContext } from './evaluate-gates';
import {
  DIA_BANDS,
  EJE_LOCALIZAR_PCT,
  EJE_REFLEXIONAR_PCT,
  ITEMS_BY_POSITION,
  NODE_NAMES,
  TABLA_1,
  TAGS_BY_ITEM,
  buildReport,
} from './fixtures/informe-3a-cierre-2025';
import type { StudentForMatch } from './student-name-matcher';

const CURSO = 'cg-3a';

const ROSTER: StudentForMatch[] = [
  { id: 'st-1', firstName: 'Camila Andrea', lastName: 'Arredondo Saballa' },
  { id: 'st-2', firstName: 'Benjamín', lastName: 'Muñoz Rojas' },
  { id: 'st-3', firstName: 'Sofía', lastName: 'Contreras Díaz' },
];

function ctx(over: Partial<GateContext> = {}): GateContext {
  return {
    file: buildReport(),
    classGroupId: CURSO,
    itemsByPosition: ITEMS_BY_POSITION,
    tagsByItem: TAGS_BY_ITEM,
    nodeNameById: NODE_NAMES,
    bands: DIA_BANDS,
    roster: ROSTER,
    ...over,
  };
}

function gate(gates: OfficialReportGateResult[], name: OfficialReportGate) {
  return gates.find((g) => g.gate === name)!;
}

describe('evaluateGates — informe real 3°A Cierre 2025 (N=43)', () => {
  it('el informe real pasa los tres gates bloqueantes y se puede confirmar', () => {
    const out = evaluateGates(ctx());

    expect(gate(out.gates, 'counts').status).toBe('passed');
    expect(gate(out.gates, 'items').status).toBe('passed');
    expect(gate(out.gates, 'skill_axes').status).toBe('passed');
    expect(out.canConfirm).toBe(true);
  });

  it('gate #3: el eje derivado de los conteos reproduce el Gráfico 2 del informe', () => {
    // Es el gate más valioso: valida de una sola vez el etiquetado de taxonomía, el
    // crédito parcial y la reconstrucción de conteos, contra el número que el propio
    // informe publica (§2.3).
    const out = evaluateGates(ctx());

    const localizar = out.skillAxes.find((a) => a.name === 'Localizar')!;
    expect(localizar.reportedPct).toBe(EJE_LOCALIZAR_PCT);
    expect(localizar.derivedPct).toBeCloseTo(77.67, 1); // 167/215
    expect(localizar.deltaPp!).toBeLessThanOrEqual(0.01);
    expect(localizar.ok).toBe(true);

    const reflexionar = out.skillAxes.find((a) => a.name === 'Reflexionar')!;
    expect(reflexionar.reportedPct).toBe(EJE_REFLEXIONAR_PCT);
    // 64.5/86 = 75.00% exacto, y solo cuadra si RPC vale 0.5.
    expect(reflexionar.derivedPct).toBeCloseTo(75.0, 2);
    expect(reflexionar.ok).toBe(true);
  });

  it('gate #3 rechaza si el crédito parcial no es el del informe', () => {
    // Con RPC = 0 (sin crédito parcial) el eje Reflexionar cae a 45/86 = 52.3% y deja
    // de cuadrar. Ésta es exactamente la clase de error que el gate existe para atajar.
    const items = TABLA_1.map((item) =>
      item.position === 14 || item.position === 19
        ? {
            ...item,
            distribution: item.distribution.map((b) => (b.key === 'RPC' ? { ...b, credit: 0 } : b)),
          }
        : item,
    );
    const out = evaluateGates(ctx({ file: buildReport({ items }) }));

    const g = gate(out.gates, 'skill_axes');
    expect(g.status).toBe('failed');
    expect(g.blocking).toBe(true);
    expect(out.canConfirm).toBe(false);
    expect(g.details.join(' ')).toContain('Reflexionar');
  });

  it('gate #3 rechaza si un ítem del eje perdió su etiqueta de taxonomía', () => {
    // Sin P8, Localizar deriva 143/172 = 83.1% ≠ 77.67 del informe.
    const tags = new Map(TAGS_BY_ITEM);
    tags.delete(ITEMS_BY_POSITION.get(8)!.id);
    const out = evaluateGates(ctx({ tagsByItem: tags }));

    expect(gate(out.gates, 'skill_axes').status).toBe('failed');
    expect(out.canConfirm).toBe(false);
  });

  it('gate #3 no elige al azar si dos nodos comparten el nombre del eje', () => {
    const names = new Map(NODE_NAMES);
    names.set('nodo-duplicado', 'Localizar');
    const out = evaluateGates(ctx({ nodeNameById: names }));

    const localizar = out.skillAxes.find((a) => a.name === 'Localizar')!;
    expect(localizar.nodeId).toBeNull();
    expect(gate(out.gates, 'skill_axes').status).toBe('failed');
  });

  it('gate #3 advierte (sin bloquear) si el informe no trae ejes', () => {
    const out = evaluateGates(ctx({ file: buildReport({ skillAxes: [] }) }));

    const g = gate(out.gates, 'skill_axes');
    expect(g.status).toBe('warning');
    expect(g.blocking).toBe(false);
    expect(out.canConfirm).toBe(true);
  });

  it('gate #1 bloquea el confirm si los conteos no suman N', () => {
    const items = TABLA_1.map((item) =>
      item.position === 4
        ? {
            ...item,
            distribution: item.distribution.map((b) => (b.key === 'C' ? { ...b, pct: 88.37 } : b)),
          }
        : item,
    );
    const out = evaluateGates(ctx({ file: buildReport({ items }) }));

    const g = gate(out.gates, 'counts');
    expect(g.status).toBe('failed');
    expect(g.blocking).toBe(true);
    expect(g.details).toEqual(['Pregunta 4']);
    expect(out.canConfirm).toBe(false);
  });

  it('gate #2 bloquea el confirm si una posición no existe en el instrumento', () => {
    const items = new Map(ITEMS_BY_POSITION);
    items.delete(19);
    const out = evaluateGates(ctx({ itemsByPosition: items }));

    const g = gate(out.gates, 'items');
    expect(g.status).toBe('failed');
    expect(g.blocking).toBe(true);
    expect(out.canConfirm).toBe(false);
  });

  it('deriva el read-model por habilidad listo para persistir', () => {
    const out = evaluateGates(ctx());

    expect(out.itemStats).toHaveLength(TABLA_1.length);
    expect(out.itemStats.every((s) => s.classGroupId === CURSO)).toBe(true);
    // P1 no tiene tags → no aporta a ningún eje. Quedan Localizar y Reflexionar.
    expect(out.skillStats.map((s) => s.nodeId).sort()).toEqual(
      [...new Set([...TAGS_BY_ITEM.values()].flat())].sort(),
    );
  });
});

describe('evaluateGates — niveles y alumnos (informe con students)', () => {
  const withStudents = buildReport({
    levelDistribution: [
      { level: 'I', pct: 0 },
      { level: 'II', pct: 33.33 },
      { level: 'III', pct: 66.67 },
    ],
    students: [
      { listNumber: '01', name: 'ARREDONDO SABALLA C.', level: 'III' },
      { listNumber: '02', name: 'MUÑOZ ROJAS B.', level: 'II' },
      { listNumber: '03', name: 'CONTRERAS DIAZ S.', level: 'III' },
    ],
  });

  it('gate #4: la distribución derivada cuadra con la reportada', () => {
    const out = evaluateGates(ctx({ file: withStudents }));

    const g = gate(out.gates, 'level_distribution');
    expect(g.status).toBe('passed');
    const nivelIII = out.levelDistribution.find((l) => l.level === 'III')!;
    expect(nivelIII.derivedPct).toBeCloseTo(66.67, 1);
    expect(nivelIII.performanceBandId).toBe('band-3');
  });

  it('gate #4 advierte pero NO bloquea si la distribución no cuadra', () => {
    // El nivel por alumno sale de OCR sobre un gráfico: una diferencia puede ser un
    // alumno mal leído, no un informe inválido. Decide el humano (§6.2 #4).
    const file = { ...withStudents, levelDistribution: [{ level: 'III', pct: 100 }] };
    const out = evaluateGates(ctx({ file }));

    const g = gate(out.gates, 'level_distribution');
    expect(g.status).toBe('warning');
    expect(g.blocking).toBe(false);
    expect(out.canConfirm).toBe(true);
  });

  it('gate #5 propone el match difuso por nombre abreviado con confianza', () => {
    const out = evaluateGates(ctx({ file: withStudents }));

    const camila = out.students[0]!;
    expect(camila.name).toBe('ARREDONDO SABALLA C.');
    expect(camila.proposedStudentId).toBe('st-1');
    expect(camila.confidence).toBe(1);
    // Aun con match perfecto es 'warning': es una PROPUESTA, la escribe el humano.
    expect(gate(out.gates, 'students').status).toBe('warning');
    expect(gate(out.gates, 'students').blocking).toBe(false);
  });

  it('gate #5 deja fuera al alumno que no cruza y lo reporta, sin inventarlo', () => {
    const file = {
      ...withStudents,
      students: [{ listNumber: '09', name: 'PERSONA INEXISTENTE X.', level: 'II' }],
    };
    const out = evaluateGates(ctx({ file }));

    expect(out.students[0]!.proposedStudentId).toBeNull();
    const g = gate(out.gates, 'students');
    expect(g.status).toBe('warning');
    expect(g.details[0]).toContain('PERSONA INEXISTENTE X.');
    // Nunca bloquea ni crea alumnos: el informe se importa igual, sin esa fila.
    expect(out.canConfirm).toBe(true);
  });

  it('advierte si la figura trae menos alumnos que el N del informe', () => {
    const out = evaluateGates(ctx({ file: withStudents }));
    expect(out.warnings.join(' ')).toContain('43');
  });

  it('advierte si un nivel no resuelve a ninguna banda del instrumento', () => {
    const file = {
      ...withStudents,
      students: [{ listNumber: '01', name: 'ARREDONDO SABALLA C.', level: 'IX' }],
    };
    const out = evaluateGates(ctx({ file }));
    expect(out.warnings.join(' ')).toContain('IX');
  });

  it('gate #4 y #5 solo advierten si el informe no trae students (§6.4: es opcional)', () => {
    const out = evaluateGates(ctx());

    expect(out.students).toEqual([]);
    expect(gate(out.gates, 'level_distribution').blocking).toBe(false);
    expect(gate(out.gates, 'students').status).toBe('passed');
    expect(out.canConfirm).toBe(true);
  });
});

describe('resolveLevelBand', () => {
  it('cruza el "I" del informe con la banda "Nivel I" del instrumento', () => {
    expect(resolveLevelBand('I', DIA_BANDS)?.id).toBe('band-1');
    expect(resolveLevelBand('II', DIA_BANDS)?.id).toBe('band-2');
    // "NIVEL II" NO puede cruzar con "I": el match es por último token, no endsWith.
    expect(resolveLevelBand('III', DIA_BANDS)?.id).toBe('band-3');
  });

  it('acepta también la etiqueta completa y la key', () => {
    expect(resolveLevelBand('Nivel II', DIA_BANDS)?.id).toBe('band-2');
    expect(resolveLevelBand('dia_nivel_2', DIA_BANDS)?.id).toBe('band-2');
  });

  it('devuelve null si el nivel no existe en el instrumento', () => {
    expect(resolveLevelBand('IX', DIA_BANDS)).toBeNull();
    expect(resolveLevelBand('II', [])).toBeNull();
  });
});
