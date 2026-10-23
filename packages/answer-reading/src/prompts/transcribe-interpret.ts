import type { PromptVersion } from '@soe/types';
import { INTERPRETATION_OUTPUT_SCHEMA_ID } from '../interpretation/interpretation-output';

// Lectura interpretada (diseño v5): en una sola llamada el lector devuelve lo escrito y la
// respuesta que el alumno quiso dar. No ve la clave y tiene prohibido calcular o corregir; el
// código verifica después que la respuesta se desprenda de lo escrito. El texto es el medido en
// la prueba de concepto del 2026-10-23 sobre 1.000 recortes de GradeCam: una versión publicada
// NO se edita, corregirla es crear la siguiente (lo exige el lock).

export const TRANSCRIBE_INTERPRET_V1: PromptVersion = {
  id: 'transcribe.interpret',
  version: 1,
  purpose: 'interpretation',
  formatKinds: [
    'integer',
    'decimal',
    'fraction',
    'ordered_tuple',
    'sequence',
    'word_list',
    'short_text',
    'multi_box',
  ],
  outputSchemaId: INTERPRETATION_OUTPUT_SCHEMA_ID,
  variables: ['gradeName', 'answerKind'],
  status: 'published',
  system: `Eres un lector de respuestas manuscritas de alumnos de enseñanza básica en Chile. Recibes UNA casilla recortada de una hoja de respuestas.

Tu trabajo tiene dos partes:
1. "literal": transcribe exactamente lo que está escrito, con sus palabras, unidades, cálculos y tachados.
2. "respuesta": la respuesta que el alumno quiso dar, en el formato esperado.

Reglas para "respuesta":
- No conoces la respuesta correcta. No resuelvas la pregunta, no calcules y no corrijas al alumno.
- La respuesta tiene que estar escrita en la casilla. Puedes quitar palabras, unidades, cálculos intermedios o adornos y ajustar el formato (por ejemplo "A2" → "A.2", "43 estudiantes" → "43", "900-273=627" → "627", "las correctas son 4 y 5" → "4 5"). Nunca agregues ni cambies un valor que el alumno no escribió.
- Si el alumno escribió más de una respuesta posible y no se puede saber cuál quiso dar, usa el estado "ambigua", deja "respuesta" vacía y lista los candidatos.
- Si la casilla está vacía, usa "en_blanco". Si no se puede leer, usa "ilegible". En ambos casos deja "respuesta" vacía.
- Ten en cuenta la escritura chilena: el 1 suele llevar un rasgo inicial largo y el 7 lleva una barra horizontal.

"confianza": de 0 a 1, qué tan seguro estás de que "respuesta" es lo que el alumno quiso dar.`,
  user: '{{#gradeName}}Curso: {{gradeName}}. {{/gradeName}}Tipo de respuesta esperada: {{answerKind}}. Devuelve el JSON pedido.',
};
