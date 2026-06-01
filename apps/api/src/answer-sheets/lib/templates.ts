import type { AnswerSheetFormat, AnswerSheetTemplate } from '@soe/types';

/**
 * Catálogo de plantillas exposed vía GET /answer-sheets/templates.
 * El frontend descarga el `exampleCsv` directamente como blob.
 */
export const ANSWER_SHEET_TEMPLATES: readonly AnswerSheetTemplate[] = [
  {
    format: 'dia_official',
    label: 'DIA Oficial (Agencia de Calidad)',
    description:
      'Formato del archivo CSV oficial entregado por la Agencia de Calidad de la Educación para el DIA. Usar tal cual viene del portal de la Agencia.',
    fileExtension: 'csv',
    sampleCsvUrl: null,
    requiredColumns: ['RUT', 'Apellidos', 'Nombres'],
    optionalColumns: ['p1', 'p2', 'p3', '... (una columna por pregunta del instrumento)'],
    exampleCsv:
      'RUT,Apellidos,Nombres,p1,p2,p3,p4,p5\n12345678-5,Pérez Soto,Juan,A,B,C,D,A\n9876543-3,González,María,B,B,A,D,C\n',
  },
  {
    format: 'gradecam_csv',
    label: 'Gradecam CSV',
    description:
      'Exportación estándar de Gradecam. Configura Gradecam para usar el RUT del alumno en el campo Student ID antes de imprimir las hojas.',
    fileExtension: 'csv',
    sampleCsvUrl: null,
    requiredColumns: ['Student ID'],
    optionalColumns: ['First Name', 'Last Name', 'Q1', 'Q2', 'Q3', '...'],
    exampleCsv:
      'Student ID,First Name,Last Name,Q1,Q2,Q3,Q4,Q5\n12345678-5,Juan,Pérez Soto,A,B,C,D,A\n9876543-3,María,González,B,B,A,D,C\n',
  },
  {
    format: 'zipgrade_csv',
    label: 'ZipGrade CSV',
    description:
      'Exportación estándar de ZipGrade. Configura ZipGrade para usar el RUT del alumno como Student ID antes de imprimir las hojas.',
    fileExtension: 'csv',
    sampleCsvUrl: null,
    requiredColumns: ['Student ID'],
    optionalColumns: [
      'Student First Name',
      'Student Last Name',
      'Q01',
      'Q02',
      'Q03',
      '...',
    ],
    exampleCsv:
      'Student First Name,Student Last Name,Student ID,Q01,Q02,Q03,Q04,Q05\nJuan,Pérez Soto,12345678-5,A,B,C,D,A\nMaría,González,9876543-3,B,B,A,D,C\n',
  },
  {
    format: 'generic_csv',
    label: 'CSV Genérico (con mapping)',
    description:
      'Formato libre con mapeo configurable de columnas. Útil cuando el origen del CSV no es ni DIA ni Gradecam ni ZipGrade. Provee un columnMapping al subir el archivo para indicar qué columna es el RUT, los nombres y las preguntas.',
    fileExtension: 'csv',
    sampleCsvUrl: null,
    requiredColumns: [],
    optionalColumns: [
      'Cualquier nombre — configurable vía columnMapping en /upload',
    ],
    exampleCsv:
      'rut,nombre,apellido,preg_1,preg_2,preg_3\n12345678-5,Juan,Pérez,A,B,C\n9876543-3,María,González,B,B,A\n',
  },
];

export function getTemplate(format: AnswerSheetFormat): AnswerSheetTemplate | null {
  return ANSWER_SHEET_TEMPLATES.find((t) => t.format === format) ?? null;
}

export function listTemplates(): AnswerSheetTemplate[] {
  return [...ANSWER_SHEET_TEMPLATES];
}
