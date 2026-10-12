import { CROP_PROFILES, cropBleedBox, regionBox, type CropBox } from './crop.schema';

const LINE: CropBox = { x0: 20, y0: 100, x1: 180, y1: 110 };

describe('cropBleedBox (margen del recorte)', () => {
  it('v1: fracción del lado mayor, igual en los cuatro lados', () => {
    expect(cropBleedBox(LINE, CROP_PROFILES['short-answer@1'], [])).toEqual({
      x0: -4,
      y0: 76,
      x1: 204,
      y1: 134,
    });
  });

  it('v2: fracción del lado menor', () => {
    const box = cropBleedBox(LINE, CROP_PROFILES['short-answer@2'], []);
    expect(box.y0).toBeCloseTo(97);
    expect(box.y1).toBeCloseTo(113);
    expect(box.x0).toBeCloseTo(17);
    expect(box.x1).toBeCloseTo(183);
  });

  it('v2: el margen de cada lado no pasa de la mitad de la distancia al vecino de ese lado', () => {
    const above: CropBox = { x0: 30, y0: 90, x1: 60, y1: 98 };
    const right: CropBox = { x0: 182, y0: 95, x1: 190, y1: 115 };
    const farBelow: CropBox = { x0: 20, y0: 150, x1: 180, y1: 160 };
    const box = cropBleedBox(LINE, CROP_PROFILES['short-answer@2'], [above, right, farBelow]);
    expect(box.y0).toBeCloseTo(99);
    expect(box.x1).toBeCloseTo(181);
    expect(box.y1).toBeCloseTo(113);
    expect(box.x0).toBeCloseTo(17);
  });

  it('un vecino que no comparte fila ni columna, o que se superpone, no limita', () => {
    const diagonal: CropBox = { x0: 190, y0: 80, x1: 200, y1: 90 };
    const overlapping: CropBox = { x0: 100, y0: 105, x1: 120, y1: 130 };
    expect(cropBleedBox(LINE, CROP_PROFILES['short-answer@2'], [diagonal, overlapping])).toEqual(
      cropBleedBox(LINE, CROP_PROFILES['short-answer@2'], []),
    );
  });

  it('v3: el margen no alcanza al número impreso de la pregunta (rótulo a la izquierda)', () => {
    const label: CropBox = { x0: 8, y0: 101, x1: 14, y1: 108 };
    const box = cropBleedBox(LINE, CROP_PROFILES['short-answer@3'], [], [label]);
    expect(box.x0).toBeCloseTo(17);
    const tight = cropBleedBox(
      LINE,
      CROP_PROFILES['short-answer@3'],
      [],
      [{ x0: 10, y0: 101, x1: 18, y1: 108 }],
    );
    expect(tight.x0).toBeCloseTo(19);
    expect(tight.y0).toBeCloseTo(97);
    expect(tight.x1).toBeCloseTo(183);
  });

  it('v1 y v2 ignoran los rótulos impresos; v3 sin rótulos recorta como v2', () => {
    const label: CropBox = { x0: 10, y0: 101, x1: 18, y1: 108 };
    for (const ref of ['short-answer@1', 'short-answer@2', 'free-text@2'] as const) {
      expect(cropBleedBox(LINE, CROP_PROFILES[ref], [], [label])).toEqual(
        cropBleedBox(LINE, CROP_PROFILES[ref], []),
      );
    }
    expect(cropBleedBox(LINE, CROP_PROFILES['short-answer@3'], [])).toEqual(
      cropBleedBox(LINE, CROP_PROFILES['short-answer@2'], []),
    );
    expect(cropBleedBox(LINE, CROP_PROFILES['free-text@3'], [])).toEqual(
      cropBleedBox(LINE, CROP_PROFILES['free-text@2'], []),
    );
  });

  it('regionBox pasa de fracciones del marco a sus unidades', () => {
    expect(
      regionBox(
        { topLeft: { x: 0.5, y: 0.25 }, bottomRight: { x: 0.1, y: 0.5 } },
        { width: 200, height: 100 },
      ),
    ).toEqual({ x0: 20, y0: 25, x1: 100, y1: 50 });
  });
});
