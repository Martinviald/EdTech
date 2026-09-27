import type { JsonObject } from './contracts';
import { REDACTED, redactState } from './redact';

describe('redactState', () => {
  it('redacta RUT con y sin puntos, con DV numérico o K', () => {
    const { state, redactions } = redactState(
      'Alumnos 12.345.678-9, 12345678-K y 7.654.321-k rindieron.',
    );
    expect(state).toBe(`Alumnos ${REDACTED}, ${REDACTED} y ${REDACTED} rindieron.`);
    expect(redactions).toBe(3);
  });

  it('redacta emails', () => {
    const { state, redactions } = redactState('Escribe a ana.perez+dia@colegio.cl si hay dudas.');
    expect(state).toBe(`Escribe a ${REDACTED} si hay dudas.`);
    expect(redactions).toBe(1);
  });

  it('no toca texto sin datos personales', () => {
    expect(redactState('El 45% logró el OA 3 en 2026.')).toEqual({
      state: 'El 45% logró el OA 3 en 2026.',
      redactions: 0,
    });
  });

  it('redacta el valor de claves sensibles sin importar tildes ni mayúsculas', () => {
    const { state, redactions } = redactState({
      Nombre: 'Ana',
      Teléfono: '+56 9 1234 5678',
      APELLIDOS: 'Pérez Soto',
      edad: 12,
    });
    expect(state).toEqual({ Nombre: REDACTED, Teléfono: REDACTED, APELLIDOS: REDACTED, edad: 12 });
    expect(redactions).toBe(3);
  });

  it('recorre objetos y arreglos anidados sin mutar la entrada', () => {
    const input: JsonObject = {
      alumno: { rut: 12345678, notas: ['contacto: apoderado@mail.com', 'sin datos'] },
      lista: [{ full_name: 'Juan Pérez', puntaje: 7 }, { correo: null }],
    };
    const snapshot = JSON.parse(JSON.stringify(input)) as JsonObject;

    const { state, redactions } = redactState(input);

    expect(state).toEqual({
      alumno: { rut: REDACTED, notas: [`contacto: ${REDACTED}`, 'sin datos'] },
      lista: [{ full_name: REDACTED, puntaje: 7 }, { correo: null }],
    });
    expect(redactions).toBe(3);
    expect(input).toEqual(snapshot);
  });

  it('redacta un valor compuesto completo cuando la clave es sensible', () => {
    const { state, redactions } = redactState([{ name: { first: 'Ana', last: 'Soto' } }]);
    expect(state).toEqual([{ name: REDACTED }]);
    expect(redactions).toBe(1);
  });
});
