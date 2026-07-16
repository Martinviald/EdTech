import type { OfficialReportImportFile } from '@soe/types';
import type { InstrumentItemForImport } from '../report-to-item-stats';

/**
 * Datos REALES del informe oficial RBD25520_DIA_LECTURA_3_A_..._Cierre_2025.pdf
 * (3°A, N=43), Tabla 1 y Gráfico 2. Son los mismos números verificados en §2.2/§2.3 del
 * plan y en `packages/types/src/utils/item-stats-calculator.spec.ts`.
 *
 * Fixture compartido por los tests del importador. Si algún día un cambio hace que este
 * informe deje de reproducirse, el importador está mal — no el fixture.
 */

export const N_3A = 43;

/** Ejes del Gráfico 2, tal como los reporta el informe. */
export const EJE_LOCALIZAR_PCT = 77.67;
export const EJE_INTERPRETAR_PCT = 80.16;
export const EJE_REFLEXIONAR_PCT = 75.0;

export const NODE_LOCALIZAR = 'aaaa0001-0000-0000-0000-000000000001';
export const NODE_REFLEXIONAR = 'aaaa0002-0000-0000-0000-000000000001';

/**
 * Tabla 1. Selección múltiple: A/B/C + N (no responde). Desarrollo: RC/RPC/RI.
 * La alternativa en negrita del informe va con `isCorrect: true`.
 *
 * P1/P4/P7/P8/P14/P19 son la distribución completa tal cual la publica el informe
 * (§2.2 del plan). De P9 y P15 solo está documentado el conteo de correctas (39 y 30,
 * §2.3): el reparto de sus distractores está construido para sumar N — lo que ambas
 * aportan al test es su columna de correctas, que es lo que entra al eje.
 */
export const TABLA_1: OfficialReportImportFile['items'] = [
  {
    position: 1,
    distribution: [
      { key: 'A', pct: 97.67, isCorrect: true },
      { key: 'B', pct: 0.0 },
      { key: 'C', pct: 2.33 },
      { key: 'N', pct: 0.0 },
    ],
  },
  {
    position: 4,
    distribution: [
      { key: 'A', pct: 4.65 },
      { key: 'B', pct: 2.33 },
      { key: 'C', pct: 90.7, isCorrect: true },
      { key: 'N', pct: 2.33 },
    ],
  },
  {
    position: 7,
    distribution: [
      { key: 'A', pct: 81.4, isCorrect: true },
      { key: 'B', pct: 9.3 },
      { key: 'C', pct: 9.3 },
      { key: 'N', pct: 0.0 },
    ],
  },
  {
    position: 8,
    distribution: [
      { key: 'A', pct: 30.23 },
      { key: 'B', pct: 11.63 },
      { key: 'C', pct: 55.81, isCorrect: true },
      { key: 'N', pct: 2.33 },
    ],
  },
  {
    position: 9,
    distribution: [
      { key: 'A', pct: 4.65 },
      { key: 'B', pct: 90.7, isCorrect: true },
      { key: 'C', pct: 2.33 },
      { key: 'N', pct: 2.33 },
    ],
  },
  {
    position: 15,
    distribution: [
      { key: 'A', pct: 69.77, isCorrect: true },
      { key: 'B', pct: 18.6 },
      { key: 'C', pct: 9.3 },
      { key: 'N', pct: 2.33 },
    ],
  },
  {
    position: 14,
    distribution: [
      { key: 'RC', pct: 55.81 },
      { key: 'RPC', pct: 41.86 },
      { key: 'RI', pct: 2.33 },
    ],
  },
  {
    position: 19,
    distribution: [
      { key: 'RC', pct: 48.84 },
      { key: 'RPC', pct: 48.84 },
      { key: 'RI', pct: 2.33 },
    ],
  },
];

/** Ítems del instrumento. Todos valen 1 punto (`scoring_config.points`). */
export const INSTRUMENT_ITEMS: InstrumentItemForImport[] = TABLA_1.map((item, i) => ({
  id: `item-${item.position}-${i}`,
  position: item.position,
  points: 1,
}));

export const ITEMS_BY_POSITION = new Map(INSTRUMENT_ITEMS.map((i) => [i.position, i]));

/** Etiquetado de taxonomía: Localizar = P4/P7/P8/P9/P15; Reflexionar = P14/P19. */
export const TAGS_BY_ITEM = new Map<string, string[]>(
  INSTRUMENT_ITEMS.filter((i) => i.position !== 1).map((i) => [
    i.id,
    [i.position === 14 || i.position === 19 ? NODE_REFLEXIONAR : NODE_LOCALIZAR],
  ]),
);

export const NODE_NAMES = new Map<string, string>([
  [NODE_LOCALIZAR, 'Localizar'],
  [NODE_REFLEXIONAR, 'Reflexionar'],
]);

/** Bandas DIA globales del instrumento (`seed-performance-bands.ts`). */
export const DIA_BANDS = [
  {
    id: 'band-1',
    key: 'dia_nivel_1',
    label: 'Nivel I',
    order: 0,
    minThreshold: 0,
    maxThreshold: 0.32,
    color: null,
  },
  {
    id: 'band-2',
    key: 'dia_nivel_2',
    label: 'Nivel II',
    order: 1,
    minThreshold: 0.32,
    maxThreshold: 0.89,
    color: null,
  },
  {
    id: 'band-3',
    key: 'dia_nivel_3',
    label: 'Nivel III',
    order: 2,
    minThreshold: 0.89,
    maxThreshold: 1,
    color: null,
  },
];

export function buildReport(
  over: Partial<OfficialReportImportFile> = {},
): OfficialReportImportFile {
  return {
    schemaVersion: '1.0',
    source: { file: 'RBD25520_DIA_LECTURA_3_A_Resultados_Asignatura_Cierre_2025.pdf' },
    report: {
      rbd: '25520',
      courseLabel: '3 A',
      period: 'cierre',
      year: 2025,
      subjectCode: 'LANG',
      gradeCode: '3RD_BASIC',
      studentCount: N_3A,
    },
    items: TABLA_1,
    skillAxes: [
      { name: 'Localizar', pct: EJE_LOCALIZAR_PCT },
      { name: 'Reflexionar', pct: EJE_REFLEXIONAR_PCT },
    ],
    levelDistribution: [],
    ...over,
  };
}
