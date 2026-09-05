import {
  effectivePrintedNumber,
  indexItemsForTagPlan,
  resolveTagPlanTarget,
  type TagPlanItem,
} from './item-tag-plan-resolver';

/** Instrumento "normal": position == número impreso, nada persistido en scoringConfig. */
const SIN_PRINTED: TagPlanItem[] = [
  { id: 'it-1', position: 1 },
  { id: 'it-2', position: 2 },
  { id: 'it-3', position: 3 },
];

/** Instrumento renumerado: los números impresos no coinciden con la posición. */
const RENUMERADO: TagPlanItem[] = [
  { id: 'comun-1', position: 1, printedNumber: '1' },
  { id: 'comun-2', position: 2, printedNumber: '2' },
  { id: 'bio-55', position: 3, printedNumber: '55' },
  { id: 'fis-55', position: 4, printedNumber: '81' },
];

describe('effectivePrintedNumber', () => {
  it('cae a la posición cuando el ítem no tiene printedNumber persistido', () => {
    expect(effectivePrintedNumber({ id: 'x', position: 7 })).toBe('7');
    expect(effectivePrintedNumber({ id: 'x', position: 7, printedNumber: null })).toBe('7');
    expect(effectivePrintedNumber({ id: 'x', position: 7, printedNumber: '' })).toBe('7');
    expect(effectivePrintedNumber({ id: 'x', position: 7, printedNumber: '12' })).toBe('12');
  });
});

describe('resolveTagPlanTarget — compatibilidad hacia atrás', () => {
  it('un plan sin printedNumber resuelve por position, igual que antes', () => {
    const index = indexItemsForTagPlan(SIN_PRINTED);
    for (const position of [1, 2, 3]) {
      const m = resolveTagPlanTarget(index, { position });
      expect(m.itemId).toBe(`it-${position}`);
      expect(m.via).toBe('position');
      expect(m.printedMismatch).toBe(false);
    }
  });

  it('una position inexistente queda sin resolver (no inventa un ítem)', () => {
    const index = indexItemsForTagPlan(SIN_PRINTED);
    const m = resolveTagPlanTarget(index, { position: 99 });
    expect(m.itemId).toBeNull();
    expect(m.via).toBeNull();
  });

  it('avisa cuando resolvió por position sobre un ítem con otro número impreso', () => {
    const index = indexItemsForTagPlan(RENUMERADO);
    const ok = resolveTagPlanTarget(index, { position: 1 });
    expect(ok.itemId).toBe('comun-1');
    expect(ok.printedMismatch).toBe(false);

    // El plan pide la posición 3; el ítem que está ahí es la pregunta impresa 55.
    const sospechoso = resolveTagPlanTarget(index, { position: 3 });
    expect(sospechoso.itemId).toBe('bio-55');
    expect(sospechoso.via).toBe('position');
    expect(sospechoso.printedMismatch).toBe(true);
  });
});

describe('resolveTagPlanTarget — clave por número impreso', () => {
  it('prefiere printedNumber sobre position cuando el plan lo declara', () => {
    const index = indexItemsForTagPlan(RENUMERADO);
    // El plan apunta al número impreso 55, que hoy vive en la posición 3.
    const m = resolveTagPlanTarget(index, { position: 999, printedNumber: '55' });
    expect(m.itemId).toBe('bio-55');
    expect(m.via).toBe('printedNumber');
  });

  it('si el número impreso no existe NO cae a position (eso sería mis-tagging)', () => {
    const index = indexItemsForTagPlan(RENUMERADO);
    const m = resolveTagPlanTarget(index, { position: 1, printedNumber: '404' });
    expect(m.itemId).toBeNull();
    expect(m.via).toBeNull();
  });

  it('un número impreso repetido en el instrumento es ambiguo y no resuelve', () => {
    const index = indexItemsForTagPlan([
      { id: 'a', position: 1, printedNumber: '55' },
      { id: 'b', position: 2, printedNumber: '55' },
    ]);
    expect([...index.ambiguousPrinted]).toEqual(['55']);
    expect(resolveTagPlanTarget(index, { position: 1, printedNumber: '55' }).itemId).toBeNull();
    // Por posición sí resuelve: es la vía histórica y sigue intacta.
    expect(resolveTagPlanTarget(index, { position: 1 }).itemId).toBe('a');
  });

  it('un ítem sin printedNumber persistido se puede direccionar por su posición impresa', () => {
    const index = indexItemsForTagPlan(SIN_PRINTED);
    const m = resolveTagPlanTarget(index, { position: 1, printedNumber: '3' });
    expect(m.itemId).toBe('it-3');
    expect(m.via).toBe('printedNumber');
  });
});
