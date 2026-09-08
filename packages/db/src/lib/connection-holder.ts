/**
 * Holder de conexión con RECONEXIÓN GUARDADA POR GENERACIÓN.
 *
 * Existe por el backfill de cohort-stats, que corre por un port-forward SSM que corta
 * conexiones en operaciones largas. Con el loop en serie alcanzaba con reemplazar el
 * cliente (`holder.db = makeDb()`); con varios workers en paralelo eso rompe de dos
 * formas:
 *
 *  · **Estampida de reconexión.** Si el túnel corta, los N workers detectan el corte y
 *    los N llaman a `connect()`. Se crean N pools y N-1 quedan huérfanos, con sus
 *    sockets abiertos hasta el `idle_timeout`.
 *  · **Cambio de cliente bajo los pies.** Un worker que reconecta le reemplaza el
 *    cliente a otro que todavía tiene una transacción viva sobre el anterior.
 *
 * La solución es una GENERACIÓN: quien va a operar anota la generación que vio, y si
 * falla pide reconectar CONTRA ESA generación. Si otro ya reconectó (la generación
 * avanzó), su pedido es un no-op y simplemente reintenta contra el cliente nuevo. El
 * resultado es exactamente UNA reconexión por corte, sin pools huérfanos y sin que
 * nadie le cambie el cliente a una transacción en vuelo.
 */

export type ConnectionHolder<T> = {
  /** Cliente vigente. Leerlo junto con `generation` antes de cada intento. */
  readonly current: T;
  /** Número de generación del cliente vigente. Arranca en 0 y sube en cada reconexión. */
  readonly generation: number;
  /**
   * Reconecta SÓLO si `seenGeneration` sigue siendo la generación vigente. Si otro
   * worker ya reconectó, no hace nada: el cliente nuevo ya está disponible.
   */
  reconnect(seenGeneration: number): Promise<void>;
  /** Cierra el cliente vigente. Idempotente en la práctica; los errores se tragan. */
  close(): Promise<void>;
};

export function createConnectionHolder<T>(opts: {
  connect: () => T;
  /** Cierre del cliente viejo. Sus errores se ignoran: casi siempre ya estaba caído. */
  close?: (conn: T) => Promise<void>;
}): ConnectionHolder<T> {
  let conn = opts.connect();
  let generation = 0;
  let inflight: Promise<void> | null = null;

  const doReconnect = async (): Promise<void> => {
    const old = conn;
    // El intercambio es SÍNCRONO (antes de cualquier await): así, cuando un segundo
    // worker entra a `reconnect` con la generación vieja, ya ve la nueva y se va sin
    // abrir otro pool. Es lo que convierte la estampida en una sola reconexión.
    conn = opts.connect();
    generation += 1;
    if (opts.close) {
      try {
        await opts.close(old);
      } catch {
        // Cerrar una conexión ya caída falla; es esperable y no es un error del backfill.
      }
    }
  };

  return {
    get current() {
      return conn;
    },
    get generation() {
      return generation;
    },
    async reconnect(seenGeneration: number): Promise<void> {
      if (seenGeneration !== generation) return; // otro worker ya reconectó
      if (inflight) return inflight; // defensivo: reconexión de esta misma generación en curso
      inflight = doReconnect().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    async close(): Promise<void> {
      if (!opts.close) return;
      try {
        await opts.close(conn);
      } catch {
        // idem
      }
    },
  };
}
