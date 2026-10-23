import type { AnswerSpace, ResponseFormat } from '@soe/types';

// Qué tipo de respuesta espera la casilla, dicho en palabras para el lector y para el
// desempate. Se deriva del formato y del espacio de respuestas (nunca de la clave). Los
// textos son los medidos en la prueba de concepto sobre 1.000 recortes: cambiarlos
// invalida el caché de esa medición.

export type AnswerKindGroup =
  | 'integer'
  | 'decimal'
  | 'fraction'
  | 'ordered_pair'
  | 'tuple'
  | 'sequence'
  | 'option_set'
  | 'matching'
  | 'short';

export function answerKindGroup(
  format: ResponseFormat,
  space: AnswerSpace | null,
): AnswerKindGroup {
  if (space?.kind === 'matching') return 'matching';
  if (space?.kind === 'option_set' && !space.ordered) return 'option_set';
  switch (format.kind) {
    case 'integer':
      return 'integer';
    case 'decimal':
      return 'decimal';
    case 'fraction':
      return 'fraction';
    case 'ordered_tuple':
      return format.arity === 2 ? 'ordered_pair' : 'tuple';
    case 'sequence':
      return 'sequence';
    default:
      return 'short';
  }
}

function sequenceLength(format: ResponseFormat): number {
  return format.kind === 'sequence' ? format.length : 4;
}

function tupleArity(format: ResponseFormat): number {
  return format.kind === 'ordered_tuple' ? format.arity : 2;
}

/** Descripción para el lector (`transcribe.interpret@1`, variable `answerKind`). */
export function readingAnswerKind(format: ResponseFormat, space: AnswerSpace | null): string {
  switch (answerKindGroup(format, space)) {
    case 'integer':
      return 'un número entero';
    case 'decimal':
      return 'un número decimal (con coma o punto decimal)';
    case 'fraction':
      return 'una fracción a/b';
    case 'ordered_pair':
      return 'un par ordenado (x,y)';
    case 'tuple':
      return `una tupla ordenada de ${tupleArity(format)} valores`;
    case 'sequence': {
      const length = sequenceLength(format);
      return length === 4
        ? 'una secuencia que ordena elementos con los números del 1 al 4, uno por casilla, escrita como dígitos seguidos (por ejemplo 3142)'
        : `una secuencia que ordena elementos con los números del 1 al ${length}, uno por casilla, escrita como dígitos seguidos`;
    }
    case 'option_set':
      return "una lista de números de opciones separados por espacios (por ejemplo '2 4 5')";
    case 'matching':
      return "un código de pareo con la letra de la columna y el número de la opción (por ejemplo 'A.2' o 'B.4'); si el alumno escribió solo el texto de la opción, ese texto es la respuesta";
    case 'short':
      return 'una respuesta corta escrita';
  }
}

/** Descripción para el desempate con el motor de decisiones. */
export function tiebreakAnswerKind(format: ResponseFormat, space: AnswerSpace | null): string {
  switch (answerKindGroup(format, space)) {
    case 'integer':
      return 'un número entero';
    case 'decimal':
      return 'un número decimal (con coma o punto decimal)';
    case 'fraction':
      return 'una fracción a/b';
    case 'ordered_pair':
      return 'un par ordenado (x,y)';
    case 'tuple':
      return `una tupla ordenada de ${tupleArity(format)} valores`;
    case 'sequence':
      return `una secuencia que ordena elementos con los números del 1 al ${sequenceLength(format)}, uno por casilla`;
    case 'option_set':
      return 'una lista de números de opciones';
    case 'matching':
      return 'el código de una opción de una columna (por ejemplo A.2) o el texto de esa opción';
    case 'short':
      return 'una respuesta corta';
  }
}
