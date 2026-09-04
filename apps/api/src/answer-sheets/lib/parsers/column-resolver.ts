import type { AnswerSheetColumnMapping } from '@soe/types';
import { normalizeHeaderText, questionColumnToLabel } from './parser.types';
import type { FormatProfile } from './format-profiles';

export interface QuestionColumn {
  index: number;
  label: string;
}

export interface ResolvedColumns {
  rutIndex: number;
  fullNameIndex: number;
  firstNameIndex: number;
  lastNameIndex: number;
  questionColumns: QuestionColumn[];
}

function findAliasIndex(
  headerNorms: readonly string[],
  aliases: readonly string[],
  ignore: ReadonlySet<string>,
  used: ReadonlySet<number>,
): number {
  for (const alias of aliases) {
    const idx = headerNorms.findIndex(
      (h, i) => h === alias && !ignore.has(h) && !used.has(i),
    );
    if (idx !== -1) return idx;
  }
  return -1;
}

function findExactColumnIndex(headerNorms: readonly string[], columnName: string): number {
  const target = normalizeHeaderText(columnName);
  return headerNorms.findIndex((h) => h === target);
}

function buildQuestionColumns(
  header: readonly string[],
  headerNorms: readonly string[],
  predicate: (rawHeader: string, index: number) => boolean,
  used: ReadonlySet<number>,
): QuestionColumn[] {
  const out: QuestionColumn[] = [];
  header.forEach((raw, index) => {
    if (used.has(index)) return;
    if (headerNorms[index].length === 0) return;
    if (!predicate(raw.trim(), index)) return;
    const label = questionColumnToLabel(raw);
    if (label) out.push({ index, label });
  });
  return out;
}

function resolveWithMapping(
  header: readonly string[],
  headerNorms: readonly string[],
  mapping: AnswerSheetColumnMapping,
): ResolvedColumns {
  const rutIndex = mapping.rut ? findExactColumnIndex(headerNorms, mapping.rut) : -1;
  const firstNameIndex = mapping.firstName
    ? findExactColumnIndex(headerNorms, mapping.firstName)
    : -1;
  const lastNameIndex = mapping.lastName
    ? findExactColumnIndex(headerNorms, mapping.lastName)
    : -1;
  const used = new Set([rutIndex, firstNameIndex, lastNameIndex].filter((i) => i !== -1));

  let predicate: (raw: string, index: number) => boolean;
  if (mapping.questionColumns && mapping.questionColumns.length > 0) {
    const wanted = new Set(mapping.questionColumns.map((c) => normalizeHeaderText(c)));
    predicate = (_raw, index) => wanted.has(headerNorms[index]);
  } else if (mapping.questionsPrefix) {
    const pattern = new RegExp(`^${escapeRegex(mapping.questionsPrefix)}0*\\d+$`, 'i');
    predicate = (raw) => pattern.test(raw);
  } else {
    predicate = () => false;
  }

  return {
    rutIndex,
    fullNameIndex: -1,
    firstNameIndex,
    lastNameIndex,
    questionColumns: buildQuestionColumns(header, headerNorms, predicate, used),
  };
}

function resolveWithProfile(
  header: readonly string[],
  headerNorms: readonly string[],
  profile: FormatProfile,
): ResolvedColumns {
  const ignore = new Set(profile.ignoreColumns);
  const used = new Set<number>();

  const rutIndex = findAliasIndex(headerNorms, profile.identityAliases, ignore, used);
  if (rutIndex !== -1) used.add(rutIndex);

  let fullNameIndex = -1;
  let firstNameIndex = -1;
  let lastNameIndex = -1;
  if (profile.nameMode === 'single-lastfirst') {
    fullNameIndex = findAliasIndex(headerNorms, profile.nameAliases.full, ignore, used);
    if (fullNameIndex !== -1) used.add(fullNameIndex);
  } else if (profile.nameMode === 'first-last-split') {
    firstNameIndex = findAliasIndex(headerNorms, profile.nameAliases.first, ignore, used);
    if (firstNameIndex !== -1) used.add(firstNameIndex);
    lastNameIndex = findAliasIndex(headerNorms, profile.nameAliases.last, ignore, used);
    if (lastNameIndex !== -1) used.add(lastNameIndex);
  }

  const questionColumns = buildQuestionColumns(
    header,
    headerNorms,
    (raw, index) => !ignore.has(headerNorms[index]) && profile.questionRegex.test(raw),
    used,
  );

  return { rutIndex, fullNameIndex, firstNameIndex, lastNameIndex, questionColumns };
}

export function resolveColumns(
  header: readonly string[],
  profile: FormatProfile,
  mapping: AnswerSheetColumnMapping | null,
): ResolvedColumns {
  const headerNorms = header.map((h) => normalizeHeaderText(h));
  return mapping
    ? resolveWithMapping(header, headerNorms, mapping)
    : resolveWithProfile(header, headerNorms, profile);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
