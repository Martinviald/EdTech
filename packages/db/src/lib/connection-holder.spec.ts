import { createConnectionHolder } from './connection-holder';

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('createConnectionHolder', () => {
  it('abre una conexión al construirse y arranca en la generación 0', () => {
    const connect = jest.fn(() => ({ id: 0 }));
    const holder = createConnectionHolder({ connect });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(holder.generation).toBe(0);
  });

  it('reconecta UNA sola vez aunque N workers pidan reconectar la misma generación', async () => {
    let n = 0;
    const connect = jest.fn(() => ({ id: n++ }));
    const closed: number[] = [];
    const holder = createConnectionHolder({
      connect,
      close: async (c) => {
        await tick(5);
        closed.push(c.id);
      },
    });

    // 8 workers ven la generación 0 y todos detectan el corte a la vez.
    const seen = holder.generation;
    await Promise.all(Array.from({ length: 8 }, () => holder.reconnect(seen)));

    expect(connect).toHaveBeenCalledTimes(2); // la inicial + UNA reconexión
    expect(holder.generation).toBe(1);
    expect(holder.current.id).toBe(1);
    expect(closed).toEqual([0]); // el pool viejo se cerró; no quedaron huérfanos
  });

  it('ignora el pedido de quien vio una generación vieja (ya reconectó otro)', async () => {
    let n = 0;
    const connect = jest.fn(() => ({ id: n++ }));
    const holder = createConnectionHolder({ connect });

    await holder.reconnect(0); // worker A reconecta
    await holder.reconnect(0); // worker B llegó tarde con la generación vieja

    expect(connect).toHaveBeenCalledTimes(2);
    expect(holder.generation).toBe(1);
  });

  it('sí reconecta de nuevo si la conexión NUEVA también se cae', async () => {
    let n = 0;
    const connect = jest.fn(() => ({ id: n++ }));
    const holder = createConnectionHolder({ connect });

    await holder.reconnect(0);
    await holder.reconnect(holder.generation); // el túnel sigue caído

    expect(connect).toHaveBeenCalledTimes(3);
    expect(holder.generation).toBe(2);
  });

  it('un error al cerrar el pool viejo no rompe la reconexión', async () => {
    const holder = createConnectionHolder({
      connect: () => ({ id: 1 }),
      close: async () => {
        throw new Error('la conexión ya estaba caída');
      },
    });
    await expect(holder.reconnect(0)).resolves.toBeUndefined();
    expect(holder.generation).toBe(1);
  });

  it('el cliente vigente nunca cambia bajo una operación que no falló', async () => {
    let n = 0;
    const holder = createConnectionHolder({ connect: () => ({ id: n++ }) });
    const before = holder.current;
    await holder.reconnect(holder.generation);
    // Quien capturó `before` sigue teniendo su objeto: el holder no muta el viejo,
    // lo reemplaza. Una transacción en vuelo sobre `before` termina contra `before`.
    expect(before.id).toBe(0);
    expect(holder.current.id).toBe(1);
  });
});
