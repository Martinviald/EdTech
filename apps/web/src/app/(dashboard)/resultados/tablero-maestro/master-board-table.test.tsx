import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import type {
  ComparabilityMeta,
  MasterBoardCell,
  MasterBoardLevel,
  MasterBoardMatrix,
  MasterBoardSubject,
  MasterBoardTest,
} from '@soe/types';
import { MasterBoardLegend, MasterBoardTable } from './master-board-table';

jest.mock('@/lib/telemetry', () => ({
  useTelemetry: () => ({ track: () => undefined }),
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const COMPARABLE: ComparabilityMeta = {
  kind: 'single_instrument',
  aggregatable: true,
  instrumentIds: ['i1'],
  familyKey: null,
  reason: null,
};

const NOT_COMPARABLE: ComparabilityMeta = {
  kind: 'mixed',
  aggregatable: false,
  instrumentIds: ['i1', 'i2'],
  familyKey: null,
  reason: 'La celda mezcla 2 instrumentos distintos.',
};

const NIVEL_II: MasterBoardLevel = { key: 'II', label: 'Nivel II', order: 2, color: 'adequate' };

function test_(
  testKey: string,
  name: string,
  shortName: string,
  source: MasterBoardTest['source'] = 'subject',
): MasterBoardTest {
  return {
    testKey,
    trackId: source === 'subject' ? null : testKey,
    source,
    name,
    shortName,
    order: 0,
    hasLevels: source !== 'section',
    mixed: false,
  };
}

function subject(subjectId: string, name: string, tests: MasterBoardTest[]): MasterBoardSubject {
  return { subjectId, name, shortName: name.slice(0, 4), tests };
}

function cell(
  subjectId: string,
  testKey: string,
  value: number | null,
  options: {
    level?: MasterBoardLevel | null;
    mixed?: boolean;
    hasLevels?: boolean;
    comparability?: ComparabilityMeta;
  } = {},
): MasterBoardCell {
  return {
    subjectId,
    testKey,
    studentsAssessed: 30,
    metrics: [
      {
        key: 'achievement',
        label: '% de logro',
        value,
        display: value === null ? '—' : `${value.toFixed(1)}%`,
        level: options.level ?? null,
        tone: null,
      },
    ],
    mixed: options.mixed ?? false,
    hasLevels: options.hasLevels ?? false,
    comparability: options.comparability ?? COMPARABLE,
    sample: null,
  };
}

function matrix(subjects: MasterBoardSubject[], cells: MasterBoardCell[]): MasterBoardMatrix {
  return {
    take: {
      label: 'Toma de prueba',
      processId: null,
      processKind: null,
      academicYearId: null,
      instrumentType: null,
      applicationPeriod: null,
      assessmentIds: [],
    },
    primaryMetricKey: 'achievement',
    availableMetrics: [{ key: 'achievement', label: '% de logro' }],
    subjects,
    grades: [{ gradeId: 'g4', name: '4° Medio', order: 12, cells, courses: [] }],
    comparability: COMPARABLE,
    redirectProcessId: null,
  };
}

function diaMatrix(): MasterBoardMatrix {
  return matrix(
    [
      subject('lang', 'Lenguaje', [test_('subject:lang', 'Lenguaje', 'Leng')]),
      subject('math', 'Matemática', [test_('subject:math', 'Matemática', 'Mate')]),
    ],
    [
      cell('lang', 'subject:lang', 64.2, { level: NIVEL_II, hasLevels: true }),
      cell('math', 'subject:math', 51, { level: NIVEL_II, hasLevels: true }),
    ],
  );
}

function paesMatrix(): MasterBoardMatrix {
  return matrix(
    [
      subject('cie', 'Ciencias', [
        test_('track:comun', 'Ciencias común', 'Común', 'section'),
        test_('track:bio', 'Biología', 'Bio', 'section'),
        test_('track:fis', 'Física', 'Fís', 'section'),
        test_('track:qui', 'Química', 'Quí', 'section'),
      ]),
      subject('lang', 'Lenguaje', [test_('subject:lang', 'Competencia lectora', 'CL')]),
      subject('math', 'Matemática', [
        test_('track:m1', 'Matemática 1', 'M1', 'instrument'),
        test_('track:m2', 'Matemática 2', 'M2', 'instrument'),
      ]),
    ],
    [
      cell('cie', 'track:qui', 40),
      cell('cie', 'track:comun', 55),
      cell('cie', 'track:bio', 48),
      cell('cie', 'track:fis', 39),
      cell('lang', 'subject:lang', 62, { mixed: true, comparability: NOT_COMPARABLE }),
      cell('math', 'track:m2', 33),
      cell('math', 'track:m1', 58.5),
    ],
  );
}

function headerRows(container: HTMLElement): HTMLTableRowElement[] {
  return Array.from(container.querySelectorAll('thead tr'));
}

describe('MasterBoardTable — encabezado', () => {
  it('sin pruebas múltiples dibuja una sola fila, como antes', () => {
    const { container } = render(<MasterBoardTable data={diaMatrix()} canViewTeacher={false} />);
    const rows = headerRows(container);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('Nivel / Curso');
    expect(rows[0]!.textContent).toContain('Leng');
    expect(rows[0]!.textContent).toContain('Mate');
  });

  it('con M1/M2 y Común/Bio/Fís/Quí dibuja dos filas', () => {
    const { container } = render(<MasterBoardTable data={paesMatrix()} canViewTeacher={false} />);
    const [top, bottom] = headerRows(container);
    expect(headerRows(container)).toHaveLength(2);

    const topHeads = Array.from(top!.querySelectorAll('th'));
    const ciencias = topHeads.find((head) => head.textContent === 'Cien');
    const matematica = topHeads.find((head) => head.textContent === 'Mate');
    const lenguaje = topHeads.find((head) => head.textContent?.startsWith('Leng'));
    expect(ciencias?.colSpan).toBe(4);
    expect(matematica?.colSpan).toBe(2);
    expect(lenguaje?.rowSpan).toBe(2);
    expect(topHeads[0]!.rowSpan).toBe(2);

    const bottomLabels = Array.from(bottom!.querySelectorAll('th')).map((head) => head.textContent);
    expect(bottomLabels).toEqual(['Común', 'Bio', 'Fís', 'Quí', 'M1', 'M2']);
  });

  it('pone cada celda bajo su prueba aunque la API las mande en otro orden', () => {
    const { container } = render(<MasterBoardTable data={paesMatrix()} canViewTeacher={false} />);
    const bodyCells = Array.from(container.querySelectorAll('tbody tr')[0]!.querySelectorAll('td'));
    expect(bodyCells.slice(1).map((td) => td.textContent)).toEqual([
      '55.0%',
      '48.0%',
      '39.0%',
      '40.0%',
      '62.0%(mixta)',
      '58.5%',
      '33.0%',
    ]);
  });

  it('marca con un aviso el encabezado de la prueba no comparable', () => {
    const { container } = render(<MasterBoardTable data={paesMatrix()} canViewTeacher={false} />);
    const flagged = container.querySelectorAll('th[data-comparability-notice="true"]');
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.textContent).toContain('Leng');
  });
});

describe('MasterBoardTable — celdas', () => {
  it('pinta la banda genérica con los tokens de nivel', () => {
    const { container } = render(<MasterBoardTable data={diaMatrix()} canViewTeacher={false} />);
    const levelCell = container.querySelector('td[data-cell-kind="level"]');
    expect(levelCell?.className).toContain('bg-level-adequate/15');
  });

  it('deja en escala neutra la celda sin niveles', () => {
    const { container } = render(<MasterBoardTable data={paesMatrix()} canViewTeacher={false} />);
    const unleveled = container.querySelectorAll('td[data-cell-kind="unleveled"]');
    expect(unleveled).toHaveLength(6);
    for (const td of Array.from(unleveled)) {
      expect(td.className).toContain('bg-muted');
      expect(td.className).not.toMatch(/bg-level-/);
    }
  });

  it('marca la celda mixta', () => {
    const { container } = render(<MasterBoardTable data={paesMatrix()} canViewTeacher={false} />);
    const mixed = container.querySelector('td[data-cell-kind="mixed"]');
    expect(mixed).not.toBeNull();
    expect(within(mixed as HTMLElement).getByText('(mixta)')).toBeTruthy();
    expect(mixed!.className).not.toMatch(/bg-level-/);
  });
});

describe('MasterBoardLegend', () => {
  it('lista solo las bandas presentes', () => {
    const { container } = render(<MasterBoardLegend data={diaMatrix()} />);
    const keys = Array.from(container.querySelectorAll('[data-legend]')).map((el) =>
      el.getAttribute('data-legend'),
    );
    expect(keys).toEqual(['adequate']);
    expect(screen.getByText('Nivel II')).toBeTruthy();
  });

  it('agrega "sin cortes de nivel" y "mixta" cuando aparecen', () => {
    const { container } = render(<MasterBoardLegend data={paesMatrix()} />);
    const keys = Array.from(container.querySelectorAll('[data-legend]')).map((el) =>
      el.getAttribute('data-legend'),
    );
    expect(keys).toEqual(['unleveled', 'mixed']);
  });
});

describe('métrica "diferencia vs muestra"', () => {
  function deltaCell(testKey: string, deltaPp: number | null): MasterBoardCell {
    const base = cell('s1', testKey, 60);
    return {
      ...base,
      metrics: [
        ...base.metrics,
        {
          key: 'sample_delta',
          label: 'Diferencia vs muestra',
          value: deltaPp,
          display: deltaPp === null ? '—' : `${deltaPp > 0 ? '+' : ''}${deltaPp.toFixed(1)}`,
          level: null,
          tone:
            deltaPp === null ? null : deltaPp < -5 ? 'below' : deltaPp > 5 ? 'above' : 'similar',
        },
      ],
    };
  }

  function deltaMatrix(): MasterBoardMatrix {
    const tests = [
      test_('a', 'Lectura', 'LEN'),
      test_('b', 'Matemática', 'MAT'),
      test_('c', 'Historia', 'HIS'),
    ];
    const data = matrix(
      [subject('s1', 'Lenguaje', tests)],
      [deltaCell('a', -8), deltaCell('b', 2), deltaCell('c', null)],
    );
    return { ...data, primaryMetricKey: 'sample_delta' };
  }

  it('pinta cada celda por su tono y deja en gris la que no tiene muestra', () => {
    const { container } = render(<MasterBoardTable data={deltaMatrix()} canViewTeacher={false} />);
    const kinds = Array.from(container.querySelectorAll('tbody td[data-cell-kind]')).map((el) =>
      el.getAttribute('data-cell-kind'),
    );
    expect(kinds).toEqual(['tone', 'tone', 'empty']);
    expect(screen.getByText('-8.0')).toBeTruthy();
    expect(screen.getByText('+2.0')).toBeTruthy();
  });

  it('la leyenda habla de la muestra, no de niveles', () => {
    const { container } = render(<MasterBoardLegend data={deltaMatrix()} />);
    const keys = Array.from(container.querySelectorAll('[data-legend]')).map((el) =>
      el.getAttribute('data-legend'),
    );
    expect(keys).toEqual(['below', 'similar', 'empty']);
    expect(screen.getByText('Frente a la muestra:')).toBeTruthy();
    expect(screen.getByText('Sin muestra')).toBeTruthy();
  });
});
