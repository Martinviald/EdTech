import {
  AUTO_ANNUL_RECOMMENDED_MIN_CONFIDENCE,
  autoAnnulMinConfidence,
  isQuickConfirmEnabled,
} from './feature.schema';

// El default de `quickConfirm` se invirtió: nació apagado "para el primer ciclo",
// nadie lo encendió, y en el primer uso real el revisor tecleó a mano 5 marcas
// cuya alternativa el motor ya había sugerido. Ahora ausente = encendido y sólo
// un `false` explícito lo apaga. Estos casos fijan esa semántica.
describe('isQuickConfirmEnabled', () => {
  it('sin config queda ENCENDIDO', () => {
    expect(isQuickConfirmEnabled(null)).toBe(true);
    expect(isQuickConfirmEnabled(undefined)).toBe(true);
    expect(isQuickConfirmEnabled({})).toBe(true);
  });

  it('con bloque review pero sin la clave queda ENCENDIDO', () => {
    expect(isQuickConfirmEnabled({ review: {} })).toBe(true);
    expect(isQuickConfirmEnabled({ review: { autoAnnulMinConfidence: 0.9 } })).toBe(true);
  });

  it('sólo un false explícito lo apaga', () => {
    expect(isQuickConfirmEnabled({ review: { quickConfirm: false } })).toBe(false);
  });

  it('true explícito lo deja encendido', () => {
    expect(isQuickConfirmEnabled({ review: { quickConfirm: true } })).toBe(true);
  });

  // Un JSONB corrupto no debe degradar la revisión en silencio: el peor caso de
  // tenerlo encendido es una pregunta de más en pantalla.
  it('config que no parsea queda ENCENDIDO', () => {
    expect(isQuickConfirmEnabled({ review: { quickConfirm: 'sí' } })).toBe(true);
  });
});

// La nula automática NO cambia de default: sigue apagada salvo valor explícito.
// Van juntas en el mismo bloque `review` y es fácil confundirlas.
describe('autoAnnulMinConfidence', () => {
  it('ausente = apagada', () => {
    expect(autoAnnulMinConfidence({})).toBeNull();
    expect(autoAnnulMinConfidence({ review: {} })).toBeNull();
    expect(autoAnnulMinConfidence({ review: { quickConfirm: true } })).toBeNull();
  });

  it('devuelve el umbral guardado', () => {
    expect(
      autoAnnulMinConfidence({
        review: { autoAnnulMinConfidence: AUTO_ANNUL_RECOMMENDED_MIN_CONFIDENCE },
      }),
    ).toBe(0.9);
  });
});
