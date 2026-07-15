import {
  OFFICIAL_REPORT_BLANK_KEY,
  OFFICIAL_REPORT_CATEGORY_CREDIT,
  reconstructCountsFromPercentages,
  type AnswerCount,
  type ItemCohortStats,
  type OfficialReportDistributionBucket,
  type OfficialReportImportFile,
  type OfficialReportItem,
} from '@soe/types';

/**
 * Traduce el informe oficial (porcentajes por curso) al read-model de cohorte
 * (conteos enteros), que es exactamente el mismo tipo que produce el flujo
 * `computed` desde `responses`.
 *
 * Función PURA: todo llega por parámetro, cero acceso a BD. Los conteos los
 * reconstruye `reconstructCountsFromPercentages` de `@soe/types` (no se reimplementa);
 * acá se resuelve lo que ese calculador no puede saber: qué bucket es correcto, cuánto
 * crédito vale cada uno y a qué `item_id` corresponde cada `position`.
 *
 * ⚠️ No "arregla" nada. Si los conteos reconstruidos no suman N, lo reporta y el gate
 * #1 rechaza el informe: repartir la diferencia enmascararía un PDF mal leído (§2.2).
 */

/** Un ítem del instrumento, con lo mínimo para traducir su distribución. */
export type InstrumentItemForImport = {
  id: string;
  position: number;
  /** `items.scoring_config.points ?? 1` — el puntaje máximo del ítem. */
  points: number;
};

export type ReportItemTranslation = {
  position: number;
  /** null si `position` no resuelve a un ítem del instrumento (gate #2). */
  itemId: string | null;
  /** null si no se pudo traducir (sin `itemId`). */
  stats: ItemCohortStats | null;
  answerCounts: AnswerCount[];
  /** Suma de los conteos reconstruidos: debe ser exactamente N (gate #1). */
  countsSum: number;
  countsMatchStudentCount: boolean;
};

export type TranslateReportResult = {
  translations: ReportItemTranslation[];
  /** Solo las traducciones completas, listas para persistir / derivar habilidades. */
  itemStats: ItemCohortStats[];
  /** Posiciones del informe sin ítem en el instrumento (gate #2). */
  unresolvedPositions: number[];
  /** Posiciones cuyos conteos no suman N (gate #1). */
  countMismatchPositions: number[];
};

/**
 * ¿Este bucket representa una respuesta correcta?
 *
 * Precedencia: el flag explícito del informe (la negrita de la alternativa) gana; si no
 * viene, la categoría `RC` es la correcta. Un `RPC` NO cuenta como correcto — aporta
 * puntaje, no acierto —, igual que en el flujo `computed`, donde `responses.is_correct`
 * de una respuesta parcial es false.
 */
export function isCorrectBucket(bucket: OfficialReportDistributionBucket): boolean {
  if (bucket.isCorrect !== undefined) return bucket.isCorrect;
  return bucket.key === 'RC';
}

/** Crédito del bucket como fracción del puntaje del ítem (0..1). */
export function bucketCredit(bucket: OfficialReportDistributionBucket): number {
  if (bucket.credit !== undefined) return bucket.credit;
  const byCategory = OFFICIAL_REPORT_CATEGORY_CREDIT[bucket.key];
  if (byCategory !== undefined) return byCategory;
  return isCorrectBucket(bucket) ? 1 : 0;
}

/** La clave "no responde" del informe es el blanco del read-model (`key: null`). */
function normalizeKey(key: string): string | null {
  return key === OFFICIAL_REPORT_BLANK_KEY ? null : key;
}

export function translateReportToItemStats(
  file: OfficialReportImportFile,
  itemsByPosition: ReadonlyMap<number, InstrumentItemForImport>,
  classGroupId: string,
): TranslateReportResult {
  const n = file.report.studentCount;
  const translations: ReportItemTranslation[] = [];
  const itemStats: ItemCohortStats[] = [];
  const unresolvedPositions: number[] = [];
  const countMismatchPositions: number[] = [];

  for (const reportItem of file.items) {
    const item = itemsByPosition.get(reportItem.position);
    const { answerCounts, countsSum } = buildAnswerCounts(reportItem, n);
    const countsMatch = countsSum === n;
    if (!countsMatch) countMismatchPositions.push(reportItem.position);

    if (!item) {
      unresolvedPositions.push(reportItem.position);
      translations.push({
        position: reportItem.position,
        itemId: null,
        stats: null,
        answerCounts,
        countsSum,
        countsMatchStudentCount: countsMatch,
      });
      continue;
    }

    const counts = reconstructCountsFromPercentages(
      reportItem.distribution.map((b) => b.pct),
      n,
    );
    let correctCount = 0;
    let scoreSum = 0;
    reportItem.distribution.forEach((bucket, i) => {
      const count = counts[i] ?? 0;
      if (isCorrectBucket(bucket)) correctCount += count;
      scoreSum += count * bucketCredit(bucket) * item.points;
    });

    const stats: ItemCohortStats = {
      classGroupId,
      itemId: item.id,
      // El informe considera a los N alumnos de la cohorte en cada pregunta: el
      // "no responde" es un bucket propio, no una fila ausente. Por eso el
      // denominador (responseCount) coincide con el N.
      studentCount: n,
      responseCount: n,
      correctCount,
      answerCounts,
      scoreSum: round2(scoreSum),
      maxSum: round2(n * item.points),
    };

    itemStats.push(stats);
    translations.push({
      position: reportItem.position,
      itemId: item.id,
      stats,
      answerCounts,
      countsSum,
      countsMatchStudentCount: countsMatch,
    });
  }

  return { translations, itemStats, unresolvedPositions, countMismatchPositions };
}

function buildAnswerCounts(
  reportItem: OfficialReportItem,
  studentCount: number,
): { answerCounts: AnswerCount[]; countsSum: number } {
  const counts = reconstructCountsFromPercentages(
    reportItem.distribution.map((b) => b.pct),
    studentCount,
  );
  const answerCounts: AnswerCount[] = reportItem.distribution.map((bucket, i) => ({
    key: normalizeKey(bucket.key),
    count: counts[i] ?? 0,
    isCorrect: isCorrectBucket(bucket),
  }));
  return {
    answerCounts: sortAnswerCounts(answerCounts),
    countsSum: counts.reduce((a, b) => a + b, 0),
  };
}

/**
 * Mismo orden estable que produce el calculador puro para el flujo `computed`
 * (blancos al final, el resto por clave). Se replica acá — y no se importa —
 * porque el calculador lo mantiene privado; que ambos escritores dejen el JSONB
 * igual es lo que hace comparable una fila importada con una computada.
 */
function sortAnswerCounts(buckets: AnswerCount[]): AnswerCount[] {
  return [...buckets].sort((a, b) => {
    if (a.key === null && b.key === null) return 0;
    if (a.key === null) return 1;
    if (b.key === null) return -1;
    return a.key.localeCompare(b.key);
  });
}

/** Los decimales de la BD son (9,2). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
