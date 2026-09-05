import { z } from 'zod';

/**
 * Rol de una sección dentro de un instrumento.
 *
 * `core` la responden todos los alumnos; `elective` sólo quienes la eligieron. Es ortogonal
 * a `sectionType` (que describe la naturaleza: multiple_choice, listening…).
 */
export const sectionRoleSchema = z.enum(['core', 'elective']);
export type SectionRole = z.infer<typeof sectionRoleSchema>;

/**
 * Rol declarado de una sección. Una electiva SIEMPRE dice a qué grupo pertenece y cuál de
 * las alternativas es; una `core` no lleva ninguno de los dos. La BDD lo impone además con
 * un CHECK (`instrument_sections_elective_ck`): esto es la validación de entrada.
 */
export const sectionRoleDeclarationSchema = z
  .object({
    role: sectionRoleSchema.default('core'),
    electiveGroup: z.string().min(1).nullable().optional(),
    electiveKey: z.string().min(1).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.role === 'elective') {
      if (!v.electiveGroup) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['electiveGroup'],
          message: 'Una sección electiva debe declarar a qué grupo pertenece',
        });
      }
      if (!v.electiveKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['electiveKey'],
          message: 'Una sección electiva debe declarar cuál de las alternativas es',
        });
      }
    } else {
      if (v.electiveGroup || v.electiveKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['role'],
          message: 'Una sección `core` no puede declarar grupo ni clave electiva',
        });
      }
    }
  });

export type SectionRoleDeclaration = z.infer<typeof sectionRoleDeclarationSchema>;

/** Una sección, reducida a lo que importa para validar la composición del instrumento. */
export type SectionForComposition = {
  id?: string;
  name: string;
  role: SectionRole;
  electiveGroup?: string | null;
  electiveKey?: string | null;
};

/**
 * Valida la composición de un instrumento con secciones electivas.
 *
 * La regla, enunciada sin nombrar ninguna prueba en particular:
 *
 *   > un alumno responde TODAS las secciones `core` más EXACTAMENTE UNA de cada
 *   > `electiveGroup` presente en el instrumento.
 *
 * De ahí salen las tres condiciones que se chequean acá: un grupo electivo necesita al
 * menos dos alternativas (con una sola no hay elección: es una `core` mal declarada), las
 * claves no se repiten dentro de un grupo, y un instrumento con electivas necesita al menos
 * una `core` (si no, no hay tronco común).
 *
 * Devuelve la lista de problemas; vacía = válido.
 */
export function validateSectionComposition(sections: SectionForComposition[]): string[] {
  const problemas: string[] = [];
  const electivas = sections.filter((s) => s.role === 'elective');
  if (electivas.length === 0) return problemas;

  if (!sections.some((s) => s.role === 'core')) {
    problemas.push('El instrumento tiene secciones electivas pero ninguna sección común');
  }

  const porGrupo = new Map<string, SectionForComposition[]>();
  for (const s of electivas) {
    const g = s.electiveGroup;
    if (!g) {
      problemas.push(`La sección "${s.name}" es electiva y no declara grupo`);
      continue;
    }
    porGrupo.set(g, [...(porGrupo.get(g) ?? []), s]);
  }

  for (const [grupo, miembros] of porGrupo) {
    if (miembros.length < 2) {
      problemas.push(
        `El grupo electivo "${grupo}" tiene una sola alternativa: no hay nada que elegir`,
      );
    }
    const claves = miembros.map((m) => m.electiveKey).filter(Boolean);
    if (new Set(claves).size !== claves.length) {
      problemas.push(`El grupo electivo "${grupo}" repite una clave de alternativa`);
    }
  }

  return problemas;
}

/**
 * Qué secciones le corresponden a un alumno, dada la composición del instrumento y la forma
 * que tiene asignada. Es el núcleo de la decisión, aislado de la BDD para poder probarlo.
 *
 * Reglas:
 *  · sin secciones electivas ⇒ `null` = todas (comportamiento de siempre, bit a bit);
 *  · con electivas y sin forma ⇒ `null` + `missingForm`: NO se corrige nada. Ni la prueba
 *    entera (le contaría mal las ramas ajenas) ni una rama por defecto (sería inventar);
 *  · con forma ⇒ todas las `core` MÁS las electivas de la forma. Las `core` van siempre,
 *    aunque la forma las omita: una forma mal armada no debe poder dejar a un alumno sin
 *    el tronco común.
 */
export function pickSectionsForStudent(
  sections: SectionForComposition[],
  formSectionIds: string[] | null | undefined,
): { sectionIds: string[] | null; hasElectives: boolean; missingForm: boolean } {
  const hasElectives = sections.some((s) => s.role === 'elective');
  if (!hasElectives) return { sectionIds: null, hasElectives: false, missingForm: false };
  if (!formSectionIds?.length) return { sectionIds: null, hasElectives: true, missingForm: true };

  const core = sections.filter((s) => s.role === 'core').map((s) => s.id!);
  const deLaForma = sections.filter((s) => s.id && formSectionIds.includes(s.id)).map((s) => s.id!);
  return {
    sectionIds: Array.from(new Set([...core, ...deLaForma])),
    hasElectives: true,
    missingForm: false,
  };
}
