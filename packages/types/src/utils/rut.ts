/**
 * Normaliza y valida un RUT chileno usando Módulo 11.
 *
 * Acepta cualquier formato común (con/sin puntos, con/sin guion, K minúscula)
 * y retorna el RUT estandarizado: cuerpo sin separadores + guion + DV mayúscula.
 *
 * Retorna `null` si el RUT es matemáticamente inválido, está vacío o tiene
 * largo fuera de [7, 8] dígitos en el cuerpo (RUTs chilenos válidos).
 *
 * Ejemplos:
 *   "12.345.678-9"  → "12345678-9"
 *   "12345678-K"    → "12345678-K"
 *   "9876543k"      → "9876543-K"
 *   "12345678-0"    → null  (DV inválido)
 */
export function normalizeRut(input: string | null | undefined): string | null {
  if (!input || typeof input !== 'string') return null;

  const cleaned = input.replace(/[.\s]/g, '').replace(/-/g, '').toUpperCase();
  if (cleaned.length < 8 || cleaned.length > 9) return null;

  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);

  if (!/^\d+$/.test(body)) return null;
  if (!/^[0-9K]$/.test(dv)) return null;

  const expected = computeDv(body);
  if (expected !== dv) return null;

  return `${body}-${dv}`;
}

function computeDv(body: string): string {
  let sum = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const mod = 11 - (sum % 11);
  if (mod === 11) return '0';
  if (mod === 10) return 'K';
  return String(mod);
}
