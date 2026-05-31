/**
 * Identidad de marca centralizada y modificable en runtime.
 *
 * El nombre se lee desde `NEXT_PUBLIC_BRAND_NAME` para poder cambiarlo sin
 * tocar código (PoC). Valor inicial: "AcademOS".
 *
 * Regla: nunca hardcodear "AcademOS" en JSX. Consumir siempre `BRAND.name`.
 */
export const BRAND = {
  /** Nombre comercial visible (header, hero, footer, <title>). */
  name: process.env.NEXT_PUBLIC_BRAND_NAME ?? 'AcademOS',
  /** Nombre descriptivo/legal del producto. */
  legalName: 'Sistema Operativo Educativo',
  /** Promesa central usada como H1 del hero. */
  tagline: 'El sistema operativo de tu colegio',
  /** Subtítulo de apoyo bajo el tagline. */
  description:
    'Plataforma EdTech con IA para colegios chilenos. Del DIA a decisiones pedagógicas en minutos, no semanas.',
} as const;
