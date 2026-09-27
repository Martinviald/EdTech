import { createHash } from 'node:crypto';
import type { Database } from '../database/database.types';
import { DecisionCallsRecorder, type DecisionCallEntry } from './decision-calls.recorder';

const ORG_ID = '00000000-0000-0000-0000-0000000000aa';

function makeDb(insertError?: Error) {
  const values = jest.fn(() => (insertError ? Promise.reject(insertError) : Promise.resolve()));
  const tx = {
    execute: jest.fn(() => Promise.resolve()),
    insert: jest.fn(() => ({ values })),
  };
  const db = {
    transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
  } as unknown as Database;
  return { db, values, tx };
}

function entry(overrides: Partial<DecisionCallEntry> = {}): DecisionCallEntry {
  return {
    orgId: ORG_ID,
    feature: 'remedial_judge',
    engine: 'jev',
    mode: 'shadow',
    state: { pregunta: '¿Qué producen las abejas?' },
    model: 'jev-1.13.0',
    answers: {
      clave: { type: 'choice', choice: 'A', probabilities: { A: 0.9, B: 0.1 }, confidence: 0.8 },
      unica: { type: 'noul', probability: 0.95 },
      nivel: { type: 'score', score: 1.1, level: 1, probabilities: [0, 0.9, 0.1], confidence: 0.7 },
    },
    errorCode: null,
    inputTokens: 1_000,
    outputTokens: 30,
    latencyMs: 123.6,
    ...overrides,
  };
}

describe('DecisionCallsRecorder', () => {
  it('guarda el hash del estado, nunca el estado en claro', async () => {
    const { db, values, tx } = makeDb();
    await new DecisionCallsRecorder(db).record(entry());

    const expectedHash = createHash('sha256')
      .update(JSON.stringify({ pregunta: '¿Qué producen las abejas?' }))
      .digest('hex');
    const row = (values.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(row.stateHash).toBe(expectedHash);
    expect(JSON.stringify(row)).not.toContain('abejas');
    expect(tx.execute).toHaveBeenCalled();
  });

  it('persiste respuestas, estado ok, latencia entera y costo con 9 decimales', async () => {
    const { db, values } = makeDb();
    await new DecisionCallsRecorder(db).record(entry());

    const row = (values.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      orgId: ORG_ID,
      status: 'ok',
      errorCode: null,
      latencyMs: 124,
      costUsd: '0.000042000',
      answers: {
        clave: { type: 'choice', choice: 'A', probabilities: { A: 0.9, B: 0.1 }, confidence: 0.8 },
        unica: { type: 'noul', probability: 0.95 },
        nivel: {
          type: 'score',
          score: 1.1,
          level: 1,
          probabilities: [0, 0.9, 0.1],
          confidence: 0.7,
        },
      },
    });
  });

  it('marca status error cuando hay errorCode', async () => {
    const { db, values } = makeDb();
    await new DecisionCallsRecorder(db).record(
      entry({ errorCode: 'timeout', model: null, answers: null, latencyMs: null }),
    );

    const row = (values.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      status: 'error',
      errorCode: 'timeout',
      costUsd: null,
      latencyMs: null,
    });
  });

  it('no lanza si el insert falla', async () => {
    const { db } = makeDb(new Error('insert falló'));

    await expect(new DecisionCallsRecorder(db).record(entry())).resolves.toBeUndefined();
  });
});
