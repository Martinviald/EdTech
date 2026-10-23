import { Test } from '@nestjs/testing';
import type { DecisionEngine } from '@soe/decisions';
import { DecisionCallsRecorder } from './decision-calls.recorder';
import { DECISION_ENGINES } from './decisions.constants';
import { DecisionsConfigService } from './decisions-config.service';
import { DecisionsModule } from './decisions.module';

const IMAGES_ENV = 'JEV_EXPERIMENTAL_IMAGES';

async function jevAcceptsImages(): Promise<boolean> {
  const moduleRef = await Test.createTestingModule({ imports: [DecisionsModule] })
    .overrideProvider(DecisionsConfigService)
    .useValue({})
    .overrideProvider(DecisionCallsRecorder)
    .useValue({})
    .compile();
  const engines = moduleRef.get<DecisionEngine[]>(DECISION_ENGINES);
  const jev = engines.find((engine) => engine.name === 'jev');
  if (!jev) throw new Error('el módulo no registra el motor jev');
  return jev.capabilities.images;
}

describe('DecisionsModule: imágenes en Jev', () => {
  const original = process.env[IMAGES_ENV];
  afterEach(() => {
    if (original === undefined) delete process.env[IMAGES_ENV];
    else process.env[IMAGES_ENV] = original;
  });

  it('sin la variable, Jev acepta imágenes', async () => {
    delete process.env[IMAGES_ENV];

    expect(await jevAcceptsImages()).toBe(true);
  });

  it.each(['true', '', 'cualquier'])('con "%s", Jev acepta imágenes', async (value) => {
    process.env[IMAGES_ENV] = value;

    expect(await jevAcceptsImages()).toBe(true);
  });

  it.each(['false', ' FALSE '])('con "%s", Jev rechaza imágenes', async (value) => {
    process.env[IMAGES_ENV] = value;

    expect(await jevAcceptsImages()).toBe(false);
  });
});
