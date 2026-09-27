import {
  DecisionError,
  FakeDecisionEngine,
  choice,
  noul,
  type DecisionEngine,
} from '@soe/decisions';
import type { DecisionMode } from '@soe/types';
import type { DecisionCallEntry, DecisionCallsRecorder } from './decision-calls.recorder';
import type { DecisionRuntimeConfig, DecisionsConfigService } from './decisions-config.service';
import {
  DECISION_MAX_CONCURRENCY,
  DECISION_MAX_SHADOW_BACKLOG,
  DECISION_SHADOW_TIMEOUT_MS,
} from './decisions.constants';
import { DecisionsService } from './decisions.service';

const ORG_ID = '00000000-0000-0000-0000-0000000000aa';

const questions = {
  clave: choice('¿Qué alternativa es correcta?', { A: 'Miel', B: 'Lana' }),
  unica: noul('¿Hay exactamente una alternativa correcta?'),
};

function configFor(mode: DecisionMode, overrides: Partial<DecisionRuntimeConfig> = {}) {
  const cfg: DecisionRuntimeConfig = {
    engine: 'jev',
    model: 'jev-1.13.0',
    mode,
    thresholds: { clave: { auto: 0.9, review: 0.6 } },
    source: 'global',
    ...overrides,
  };
  return { resolve: jest.fn().mockResolvedValue(cfg) } as unknown as DecisionsConfigService & {
    resolve: jest.Mock;
  };
}

function makeRecorder() {
  const entries: DecisionCallEntry[] = [];
  const recorder = {
    record: jest.fn((entry: DecisionCallEntry) => {
      entries.push(entry);
      return Promise.resolve();
    }),
  } as unknown as DecisionCallsRecorder;
  return { recorder, entries };
}

function jevNamed(engine: FakeDecisionEngine): DecisionEngine {
  return {
    name: 'jev',
    isAvailable: () => engine.isAvailable(),
    evaluate: (request) => engine.evaluate(request),
  };
}

function makeService(mode: DecisionMode, engine = new FakeDecisionEngine()) {
  const config = configFor(mode);
  const { recorder, entries } = makeRecorder();
  const service = new DecisionsService(config, recorder, [jevNamed(engine)]);
  return { service, config, entries, engine };
}

const answeredEngine = () =>
  new FakeDecisionEngine({
    answers: {
      clave: { type: 'choice', choice: 'A', probabilities: { A: 0.95, B: 0.05 }, confidence: 0.9 },
      unica: { type: 'noul', probability: 0.97 },
    },
  });

describe('DecisionsService.evaluate', () => {
  it('en modo live devuelve las respuestas tipadas con los umbrales y registra la llamada', async () => {
    const { service, entries, engine } = makeService('live', answeredEngine());

    const outcome = await service.evaluate(ORG_ID, 'remedial_judge', { state: 's', questions });

    expect(outcome.answers.clave.choice).toBe('A');
    expect(outcome.answers.unica.probability).toBe(0.97);
    expect(outcome.thresholds).toEqual({ clave: { auto: 0.9, review: 0.6 } });
    expect(engine.calls[0]?.model).toBe('jev-1.13.0');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ mode: 'live', errorCode: null, orgId: ORG_ID });
  });

  it.each<DecisionMode>(['off', 'shadow'])(
    'en modo %s lanza disabled sin llamar al motor',
    async (mode) => {
      const { service, entries, engine } = makeService(mode, answeredEngine());

      await expect(
        service.evaluate(ORG_ID, 'remedial_judge', { state: 's', questions }),
      ).rejects.toMatchObject({ code: 'disabled' });
      expect(engine.calls).toHaveLength(0);
      expect(entries).toHaveLength(0);
    },
  );

  it('lanza unavailable si el motor no tiene credenciales', async () => {
    const { service } = makeService('live', new FakeDecisionEngine({ available: false }));

    await expect(
      service.evaluate(ORG_ID, 'remedial_judge', { state: 's', questions }),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('registra la falla del motor y relanza el DecisionError', async () => {
    const failing = new FakeDecisionEngine({ error: new DecisionError('rate_limited', '429') });
    const { service, entries } = makeService('live', failing);

    await expect(
      service.evaluate(ORG_ID, 'remedial_judge', { state: 's', questions }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    expect(entries[0]).toMatchObject({
      errorCode: 'rate_limited',
      model: 'jev-1.13.0',
      answers: null,
    });
    expect(entries[0]?.latencyMs).toEqual(expect.any(Number));
  });

  it('normaliza un error que no es DecisionError a upstream', async () => {
    const engine: DecisionEngine = {
      name: 'jev',
      isAvailable: () => true,
      evaluate: () => Promise.reject(new Error('socket colgado')),
    };
    const { recorder, entries } = makeRecorder();
    const service = new DecisionsService(configFor('live'), recorder, [engine]);

    await expect(
      service.evaluate(ORG_ID, 'remedial_judge', { state: 's', questions }),
    ).rejects.toMatchObject({ code: 'upstream', message: 'socket colgado' });
    expect(entries[0]?.errorCode).toBe('upstream');
  });
});

describe('DecisionsService.shadow', () => {
  it('en modo shadow corre el motor y registra respuesta, baseline y correlationId', async () => {
    const { service, entries } = makeService('shadow', answeredEngine());

    await service.shadow(
      ORG_ID,
      'remedial_judge',
      { state: 's', questions },
      { baseline: { realKey: 'A' }, correlationId: 'item-1' },
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      mode: 'shadow',
      baseline: { realKey: 'A' },
      correlationId: 'item-1',
      errorCode: null,
    });
  });

  it.each<DecisionMode>(['off', 'live'])('en modo %s no llama al motor', async (mode) => {
    const { service, entries, engine } = makeService(mode, answeredEngine());

    await service.shadow(ORG_ID, 'remedial_judge', { state: 's', questions });

    expect(engine.calls).toHaveLength(0);
    expect(entries).toHaveLength(0);
  });

  it('sin credenciales no hace nada', async () => {
    const { service, entries } = makeService(
      'shadow',
      new FakeDecisionEngine({ available: false }),
    );

    await service.shadow(ORG_ID, 'remedial_judge', { state: 's', questions });

    expect(entries).toHaveLength(0);
  });

  it('nunca rechaza: una falla del motor queda registrada', async () => {
    const failing = new FakeDecisionEngine({ error: new DecisionError('timeout', 'lento') });
    const { service, entries } = makeService('shadow', failing);

    await expect(
      service.shadow(ORG_ID, 'remedial_judge', { state: 's', questions }),
    ).resolves.toBeUndefined();
    expect(entries[0]).toMatchObject({ mode: 'shadow', errorCode: 'timeout' });
  });

  it('nunca rechaza aunque falle la lectura de configuración', async () => {
    const config = {
      resolve: jest.fn().mockRejectedValue(new Error('bd caída')),
    } as unknown as DecisionsConfigService;
    const { recorder, entries } = makeRecorder();
    const service = new DecisionsService(config, recorder, [jevNamed(answeredEngine())]);

    await expect(
      service.shadow(ORG_ID, 'remedial_judge', { state: 's', questions }),
    ).resolves.toBeUndefined();
    expect(entries).toHaveLength(0);
  });
});

describe('DecisionsService.isLive', () => {
  it('es true solo en live y con el motor disponible', async () => {
    await expect(makeService('live').service.isLive(ORG_ID, 'remedial_judge')).resolves.toBe(true);
    await expect(makeService('shadow').service.isLive(ORG_ID, 'remedial_judge')).resolves.toBe(
      false,
    );
    await expect(
      makeService('live', new FakeDecisionEngine({ available: false })).service.isLive(
        ORG_ID,
        'remedial_judge',
      ),
    ).resolves.toBe(false);
  });
});

describe('DecisionsService: protecciones', () => {
  it('redacta RUT y nombres del estado antes de llamar al motor y registra el estado redactado', async () => {
    const { service, entries, engine } = makeService('live', answeredEngine());

    await service.evaluate(ORG_ID, 'remedial_judge', {
      state: { nombre: 'Ana Pérez', pregunta: 'El RUT 12.345.678-5 es de quién' },
      questions,
    });

    const sent = JSON.stringify(engine.calls[0]?.state);
    expect(sent).not.toContain('Ana Pérez');
    expect(sent).not.toContain('12.345.678-5');
    expect(JSON.stringify(entries[0]?.state)).toBe(sent);
  });

  it('en sombra aplica un timeout corto si el llamador no fijó uno', async () => {
    const { service, engine } = makeService('shadow', answeredEngine());

    await service.shadow(ORG_ID, 'remedial_judge', { state: 's', questions });

    expect(engine.calls[0]?.timeoutMs).toBe(DECISION_SHADOW_TIMEOUT_MS);
  });

  it('descarta la sombra cuando la cola de espera está llena', async () => {
    const release: Array<() => void> = [];
    const blocking: DecisionEngine = {
      name: 'jev',
      isAvailable: () => true,
      evaluate: () =>
        new Promise((_, reject) => {
          release.push(() => reject(new DecisionError('timeout', 'liberado')));
        }),
    };
    const { recorder, entries } = makeRecorder();
    const service = new DecisionsService(configFor('shadow'), recorder, [blocking]);
    const request = { state: 's', questions };

    const inFlight = Array.from(
      { length: DECISION_MAX_CONCURRENCY + DECISION_MAX_SHADOW_BACKLOG },
      () => service.shadow(ORG_ID, 'remedial_judge', request),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const dropped = service.shadow(ORG_ID, 'remedial_judge', request);
    await expect(dropped).resolves.toBeUndefined();

    let settled = false;
    const all = Promise.all(inFlight).then(() => {
      settled = true;
    });
    while (!settled) {
      release.splice(0).forEach((releaseCall) => releaseCall());
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await all;

    expect(entries).toHaveLength(DECISION_MAX_CONCURRENCY + DECISION_MAX_SHADOW_BACKLOG);
  });
});
