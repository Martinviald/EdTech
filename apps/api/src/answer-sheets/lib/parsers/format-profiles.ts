export type NameMode = 'single-lastfirst' | 'first-last-split' | 'none';

export interface FormatProfile {
  identityAliases: string[];
  ignoreColumns: string[];
  nameMode: NameMode;
  nameAliases: { full: string[]; first: string[]; last: string[] };
  questionRegex: RegExp;
  footerLabels: string[];
  minQuestionColsForHeader: number;
}

const DEFAULT_FOOTER_LABELS = [
  'answers / max points',
  'answers',
  'max points',
  'promedio',
  'average',
  'total',
  'mean',
  'class average',
  'puntaje',
];

export const DIA_OFFICIAL_PROFILE: FormatProfile = {
  identityAliases: ['rut', 'run'],
  ignoreColumns: [],
  nameMode: 'first-last-split',
  nameAliases: {
    full: [],
    first: ['nombres', 'nombre'],
    last: ['apellidos', 'apellido'],
  },
  questionRegex: /^p\s*0*\d+$/i,
  footerLabels: DEFAULT_FOOTER_LABELS,
  minQuestionColsForHeader: 1,
};

export const GRADECAM_PROFILE: FormatProfile = {
  identityAliases: ['id', 'student id', 'studentid', 'rut', 'run'],
  ignoreColumns: ['gradecam id'],
  nameMode: 'single-lastfirst',
  nameAliases: {
    full: ['name', 'nombre', 'student', 'alumno'],
    first: [],
    last: [],
  },
  questionRegex: /^(?:q)?\s*0*\d+$/i,
  footerLabels: DEFAULT_FOOTER_LABELS,
  minQuestionColsForHeader: 3,
};

export const ZIPGRADE_PROFILE: FormatProfile = {
  identityAliases: ['student id', 'studentid', 'id', 'rut', 'run'],
  ignoreColumns: [],
  nameMode: 'first-last-split',
  nameAliases: {
    full: [],
    first: ['student first name', 'first name', 'nombres', 'nombre'],
    last: ['student last name', 'last name', 'apellidos', 'apellido'],
  },
  questionRegex: /^q\s*0*\d+$/i,
  footerLabels: DEFAULT_FOOTER_LABELS,
  minQuestionColsForHeader: 1,
};

export const GENERIC_PROFILE: FormatProfile = {
  identityAliases: ['rut', 'run', 'student id', 'studentid', 'id'],
  ignoreColumns: [],
  nameMode: 'first-last-split',
  nameAliases: {
    full: [],
    first: ['nombre', 'nombres', 'first name'],
    last: ['apellido', 'apellidos', 'last name'],
  },
  questionRegex: /^[a-z]*\s*0*\d+$/i,
  footerLabels: DEFAULT_FOOTER_LABELS,
  minQuestionColsForHeader: 1,
};
