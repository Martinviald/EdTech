import type { DecisionError } from '../contracts';

type FitImageModule = typeof import('./fit-image');
type ContractsModule = typeof import('../contracts');
type JevLimitsModule = typeof import('../jev/jev-limits');

function loadIsolated<T>(load: () => T): T {
  let loaded: T | undefined;
  jest.isolateModules(() => {
    loaded = load();
  });
  if (loaded === undefined) throw new Error('No se cargó el módulo aislado.');
  return loaded;
}

describe('carga diferida de sharp', () => {
  afterEach(() => {
    jest.dontMock('sharp');
    jest.resetModules();
  });

  it('importar el paquete no carga sharp', () => {
    const factory = jest.fn(() => ({ default: jest.fn() }));
    jest.doMock('sharp', factory);
    loadIsolated(() => jest.requireActual<object>('../index'));
    expect(factory).not.toHaveBeenCalled();
  });

  it('si sharp no carga, fitImage falla con unavailable sin lanzar al importar', async () => {
    jest.doMock('sharp', () => {
      throw new Error('Could not load the "sharp" module using the linux-x64 runtime');
    });
    const { fitImage, contracts, limits } = loadIsolated(() => ({
      fitImage: jest.requireActual<FitImageModule>('./fit-image').fitImage,
      contracts: jest.requireActual<ContractsModule>('../contracts'),
      limits: jest.requireActual<JevLimitsModule>('../jev/jev-limits'),
    }));

    const failure = fitImage(Buffer.from('x'), limits.JEV_IMAGE_CONSTRAINTS, 300);

    await expect(failure).rejects.toBeInstanceOf(contracts.DecisionError);
    await expect(failure).rejects.toMatchObject<Partial<DecisionError>>({
      code: 'unavailable',
      message: expect.stringContaining('sharp'),
    });
  });

  it('un fallo de carga no se memoiza: la llamada siguiente reintenta', async () => {
    let attempts = 0;
    jest.doMock('sharp', () => {
      attempts += 1;
      throw new Error('binario ausente');
    });
    const { fitImage, limits } = loadIsolated(() => ({
      fitImage: jest.requireActual<FitImageModule>('./fit-image').fitImage,
      limits: jest.requireActual<JevLimitsModule>('../jev/jev-limits'),
    }));

    await expect(
      fitImage(Buffer.from('x'), limits.JEV_IMAGE_CONSTRAINTS, 300),
    ).rejects.toMatchObject({ code: 'unavailable' });
    await expect(
      fitImage(Buffer.from('x'), limits.JEV_IMAGE_CONSTRAINTS, 300),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(attempts).toBe(2);
  });
});
