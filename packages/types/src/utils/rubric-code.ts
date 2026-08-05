// Normalización del código de nivel que quien corrige anota en la hoja.
//
// La tolerancia es deliberadamente angosta: sólo el cero a la izquierda de un
// código NUMÉRICO, porque "01" y "1" son el mismo número escrito distinto y
// perder medio punto por eso sería castigar al alumno por el tipeo del corrector.
// Todo lo demás se deja intacto — "12" no es el código 1 ni el 2, y un código
// no numérico ("NR", "A") se compara tal cual. Un normalizador más permisivo
// convertiría una marca ilegible en una nota, que es exactamente lo que la
// estrategia evita dejando esas respuestas pendientes.

/** `"02"` → `"2"`, `"007"` → `"7"`, `"0"` → `"0"`. Cualquier otra cosa, sin cambios. */
export function normalizeRubricCode(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return trimmed;
  return trimmed.replace(/^0+(?=\d)/, '');
}

/** Dos códigos son el mismo nivel si coinciden salvo ceros a la izquierda y mayúsculas. */
export function sameRubricCode(a: string, b: string): boolean {
  return (
    normalizeRubricCode(a).toLocaleLowerCase('es') ===
    normalizeRubricCode(b).toLocaleLowerCase('es')
  );
}
