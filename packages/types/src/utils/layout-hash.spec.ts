import { layoutHash, LAYOUT_HASH_LENGTH } from './layout-hash';
import { layoutSpecSchema, type LayoutSpec } from '../schemas/omr-layout.schema';

const baseSpec: LayoutSpec = {
  specVersion: 1,
  instrumentId: '9f2c1a44-3b7e-4c11-9a0d-5e8f7b2c1d33',
  pageCount: 2,
  paper: 'letter',
  fiducials: { kind: 'corner_squares', sizeRatio: 0.02, marginRatio: 0.03 },
  identity: {
    mode: 'qr',
    region: { topLeft: { x: 0.75, y: 0.02 }, bottomRight: { x: 0.98, y: 0.15 } },
  },
  fields: [
    {
      fieldId: 'f_001',
      kind: 'bubble_group',
      printedNumber: '1',
      pageIndex: 0,
      selectMode: 'single',
      bubbles: [
        { value: 'A', center: { x: 0.1, y: 0.2 }, radius: 0.012 },
        { value: 'B', center: { x: 0.15, y: 0.2 }, radius: 0.012 },
      ],
      region: null,
    },
  ],
};

describe('layoutHash', () => {
  it('produce un hash hex de largo fijo', () => {
    const hash = layoutHash(baseSpec);
    expect(hash).toMatch(new RegExp(`^[0-9a-f]{${LAYOUT_HASH_LENGTH}}$`));
  });

  it('es determinístico', () => {
    expect(layoutHash(baseSpec)).toBe(layoutHash(structuredClone(baseSpec)));
  });

  it('es estable ante reordenamiento de claves', () => {
    const reordered = {
      fields: baseSpec.fields.map((f) => ({
        region: f.region,
        bubbles: f.bubbles.map((b) => ({
          radius: b.radius,
          center: { y: b.center.y, x: b.center.x },
          value: b.value,
        })),
        selectMode: f.selectMode,
        pageIndex: f.pageIndex,
        printedNumber: f.printedNumber,
        kind: f.kind,
        fieldId: f.fieldId,
      })),
      identity: { region: baseSpec.identity.region, mode: baseSpec.identity.mode },
      fiducials: {
        marginRatio: baseSpec.fiducials.marginRatio,
        sizeRatio: baseSpec.fiducials.sizeRatio,
        kind: baseSpec.fiducials.kind,
      },
      paper: baseSpec.paper,
      pageCount: baseSpec.pageCount,
      instrumentId: baseSpec.instrumentId,
      specVersion: baseSpec.specVersion,
    } as LayoutSpec;
    expect(layoutHash(reordered)).toBe(layoutHash(baseSpec));
  });

  it('es estable ante ruido numérico bajo la precisión de 6 decimales', () => {
    const noisy = structuredClone(baseSpec);
    noisy.fields[0]!.bubbles[0]!.center.x = 0.1000000001;
    expect(layoutHash(noisy)).toBe(layoutHash(baseSpec));
  });

  it('cambia si cambia una coordenada real', () => {
    const moved = structuredClone(baseSpec);
    moved.fields[0]!.bubbles[0]!.center.x = 0.11;
    expect(layoutHash(moved)).not.toBe(layoutHash(baseSpec));
  });

  it('cambia si se agrega un campo (instrumento editado tras imprimir, G1)', () => {
    const edited = structuredClone(baseSpec);
    edited.fields.push({ ...edited.fields[0]!, fieldId: 'f_002', printedNumber: '2' });
    expect(layoutHash(edited)).not.toBe(layoutHash(baseSpec));
  });

  it('ignora claves con valor undefined', () => {
    const withUndefined = structuredClone(baseSpec) as LayoutSpec & { extra?: undefined };
    withUndefined.extra = undefined;
    expect(layoutHash(withUndefined)).toBe(layoutHash(baseSpec));
  });

  it('rechaza números no finitos', () => {
    const broken = structuredClone(baseSpec);
    broken.fields[0]!.bubbles[0]!.radius = Number.POSITIVE_INFINITY;
    expect(() => layoutHash(broken)).toThrow();
  });
});

describe('layoutHash — estabilidad de specs MVP tras las enmiendas v1 (CD-8/CD-10/CD-12)', () => {
  const MVP_REFERENCE_HASH = 'a9718c3cc1e24e82';

  it('un spec del MVP conserva el hash calculado antes de las enmiendas', () => {
    expect(layoutHash(baseSpec)).toBe(MVP_REFERENCE_HASH);
  });

  it('parsear un spec del MVP con el schema v1 no materializa campos nuevos ni cambia el hash', () => {
    expect(layoutHash(layoutSpecSchema.parse(baseSpec))).toBe(MVP_REFERENCE_HASH);
  });

  const v1Spec: LayoutSpec = {
    ...structuredClone(baseSpec),
    identity: {
      mode: 'rut_bubbles',
      region: { topLeft: { x: 0.06, y: 0.03 }, bottomRight: { x: 0.5, y: 0.2 } },
      bubbles: [
        { value: '1', center: { x: 0.08, y: 0.05 }, radius: 0.009, group: 0 },
        { value: 'K', center: { x: 0.12, y: 0.05 }, radius: 0.009, group: 1 },
      ],
    },
    fields: [
      ...structuredClone(baseSpec.fields),
      {
        fieldId: 'f_014',
        kind: 'digit_grid',
        printedNumber: '14',
        pageIndex: 0,
        selectMode: 'single',
        bubbles: [
          { value: '0', center: { x: 0.6, y: 0.3 }, radius: 0.009, group: 0 },
          { value: '1', center: { x: 0.6, y: 0.32 }, radius: 0.009, group: 0 },
          { value: '0', center: { x: 0.65, y: 0.3 }, radius: 0.009, group: 1 },
          { value: '1', center: { x: 0.65, y: 0.32 }, radius: 0.009, group: 1 },
        ],
        region: null,
      },
    ],
  };

  it('un spec v1 con group hashea determinístico', () => {
    expect(layoutHash(v1Spec)).toBe(layoutHash(structuredClone(v1Spec)));
    expect(layoutHash(layoutSpecSchema.parse(v1Spec))).toBe(layoutHash(v1Spec));
    expect(layoutHash(v1Spec)).toMatch(new RegExp(`^[0-9a-f]{${LAYOUT_HASH_LENGTH}}$`));
  });

  it('el group participa del hash: cambiar el dígito de una burbuja cambia el hash', () => {
    const moved = structuredClone(v1Spec);
    moved.fields[1]!.bubbles[0]!.group = 2;
    expect(layoutHash(moved)).not.toBe(layoutHash(v1Spec));
  });
});
