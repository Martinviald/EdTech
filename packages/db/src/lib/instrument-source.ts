/** Lo mínimo de un JSON de instrumento para identificarlo y leer su línea de prueba. */
export type InstrumentSourceDoc = {
  instrument: { name: string; track?: string | null };
  pauta?: { source?: { instrumentJson?: string } };
};

/**
 * Identificador estable de un JSON importado (`instruments.config.sourceJson`): es la clave de
 * idempotencia del importador y la que usan los backfills para cruzar un JSON con la BDD.
 */
export function instrumentSourceJson(doc: InstrumentSourceDoc): string {
  return doc.pauta?.source?.instrumentJson ?? `imported/${doc.instrument.name}`;
}
