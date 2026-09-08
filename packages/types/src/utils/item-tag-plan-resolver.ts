/**
 * Resolución del ítem al que apunta cada entrada de un `item-tags-plan.json`.
 *
 * Función pura, sin acceso a DB, para que el emparejamiento del importador de tags
 * (`packages/db/src/seed/import-item-tags.ts`) se pueda testear sin base de datos.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────────
 * El importador emparejaba por `(instruments.config->>'sourceJson', items.position)`.
 * `position` es el orden del ítem DENTRO del instrumento: si el instrumento se
 * re-extrae con otro corte de secciones —fusionar los 9 instrumentos de Ciencias en
 * 3, por ejemplo— las posiciones se renumeran y **los tags se aplican al ítem
 * equivocado sin que nada lo detecte**: el script sólo cuenta un fallo cuando la
 * posición NO existe, y después de renumerar existen todas.
 *
 * El número IMPRESO en el cuadernillo (`items.scoring_config.printedNumber`) sí es
 * estable frente a una renumeración, y es la clave que usan las fichas técnicas.
 *
 * ── Compatibilidad hacia atrás (criterio de aceptación) ──────────────────────────
 * Los planes existentes traen sólo `position`, y re-aplicarlos tiene que producir
 * exactamente los mismos tags que hoy. Por eso la regla es:
 *
 *  · La entrada del plan trae `printedNumber` ⇒ se resuelve POR NÚMERO IMPRESO.
 *    Si no hay ítem con ese número impreso, la entrada queda sin resolver: NO se
 *    cae a `position`, porque caer sería justamente el mis-tagging silencioso.
 *  · La entrada NO trae `printedNumber` ⇒ se resuelve por `position`, bit a bit
 *    como antes. Se marca `printedMismatch` cuando el ítem encontrado tiene un
 *    número impreso distinto de su posición: es la señal de que ese plan quedó
 *    ambiguo y hay que regenerarlo con `printedNumber` antes de renumerar nada.
 *
 * El número impreso efectivo de un ítem es `printedNumber ?? String(position)`:
 * `import-instruments.ts` sólo persiste `printedNumber` cuando difiere de la
 * posición, así que la mayoría de los ítems no lo tiene guardado y su número
 * impreso es su posición.
 */

/** Un ítem del instrumento, tal como se indexa para resolver el plan. */
export type TagPlanItem = {
  id: string;
  position: number;
  /** `scoring_config.printedNumber`, si está persistido. */
  printedNumber?: string | null;
};

/** Una entrada del plan (`item-tags-plan.json`), sin sus tags. */
export type TagPlanTarget = {
  position: number;
  /** Clave preferente. Opcional para no romper los planes ya existentes. */
  printedNumber?: string | null;
};

/** Cómo se resolvió una entrada del plan. */
export type TagPlanMatchVia = 'printedNumber' | 'position';

export type TagPlanMatch = {
  itemId: string | null;
  via: TagPlanMatchVia | null;
  /**
   * `true` cuando se resolvió por `position` sobre un ítem cuyo número impreso difiere
   * de su posición. El tag se aplica igual (comportamiento histórico), pero el plan
   * está apuntando a una posición que no es el número de la pregunta impresa.
   */
  printedMismatch: boolean;
};

/** Índice de los ítems de UN instrumento. */
export type TagPlanIndex = {
  byPrinted: ReadonlyMap<string, string>;
  byPosition: ReadonlyMap<number, string>;
  /** Números impresos repetidos dentro del instrumento: no se pueden usar como clave. */
  ambiguousPrinted: ReadonlySet<string>;
  printedByItemId: ReadonlyMap<string, string>;
};

/** Número impreso efectivo de un ítem. */
export function effectivePrintedNumber(item: TagPlanItem): string {
  const p = item.printedNumber;
  return p != null && p !== '' ? p : String(item.position);
}

export function indexItemsForTagPlan(items: readonly TagPlanItem[]): TagPlanIndex {
  const byPrinted = new Map<string, string>();
  const byPosition = new Map<number, string>();
  const ambiguousPrinted = new Set<string>();
  const printedByItemId = new Map<string, string>();

  for (const it of items) {
    const printed = effectivePrintedNumber(it);
    printedByItemId.set(it.id, printed);
    if (byPrinted.has(printed)) ambiguousPrinted.add(printed);
    else byPrinted.set(printed, it.id);
    // La primera posición gana, igual que el `Map.set` incondicional de antes no
    // podía tener duplicados: `position` es única por instrumento en la práctica.
    if (!byPosition.has(it.position)) byPosition.set(it.position, it.id);
  }

  for (const dup of ambiguousPrinted) byPrinted.delete(dup);

  return { byPrinted, byPosition, ambiguousPrinted, printedByItemId };
}

export function resolveTagPlanTarget(index: TagPlanIndex, target: TagPlanTarget): TagPlanMatch {
  const declared = target.printedNumber;
  if (declared != null && declared !== '') {
    const itemId = index.byPrinted.get(declared) ?? null;
    return { itemId, via: itemId ? 'printedNumber' : null, printedMismatch: false };
  }

  const itemId = index.byPosition.get(target.position) ?? null;
  if (!itemId) return { itemId: null, via: null, printedMismatch: false };
  const printed = index.printedByItemId.get(itemId);
  return {
    itemId,
    via: 'position',
    printedMismatch: printed != null && printed !== String(target.position),
  };
}
