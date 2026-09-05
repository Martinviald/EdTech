import {
  pickSectionsForStudent,
  sectionRoleDeclarationSchema,
  validateSectionComposition,
  type SectionForComposition,
} from './elective-sections.schema';

const core = (name: string): SectionForComposition => ({ name, role: 'core' });
const elect = (name: string, group: string, key: string): SectionForComposition => ({
  name,
  role: 'elective',
  electiveGroup: group,
  electiveKey: key,
});

describe('sectionRoleDeclarationSchema', () => {
  it('acepta una sección core sin datos electivos', () => {
    expect(sectionRoleDeclarationSchema.parse({ role: 'core' }).role).toBe('core');
  });

  it('por defecto una sección es core', () => {
    expect(sectionRoleDeclarationSchema.parse({}).role).toBe('core');
  });

  it('rechaza una electiva sin grupo', () => {
    const r = sectionRoleDeclarationSchema.safeParse({ role: 'elective', electiveKey: 'BIO' });
    expect(r.success).toBe(false);
  });

  it('rechaza una electiva sin clave', () => {
    const r = sectionRoleDeclarationSchema.safeParse({ role: 'elective', electiveGroup: 'g' });
    expect(r.success).toBe(false);
  });

  it('rechaza una core que declara datos electivos', () => {
    const r = sectionRoleDeclarationSchema.safeParse({ role: 'core', electiveGroup: 'g' });
    expect(r.success).toBe(false);
  });
});

describe('validateSectionComposition', () => {
  it('no dice nada de un instrumento sin electivas (el caso de hoy)', () => {
    expect(validateSectionComposition([core('Texto 1'), core('Texto 2')])).toEqual([]);
  });

  it('acepta tronco común + tres ramas', () => {
    const problemas = validateSectionComposition([
      core('Módulo común'),
      elect('Mención Biología', 'mencion-ciencias', 'BIO'),
      elect('Mención Física', 'mencion-ciencias', 'FIS'),
      elect('Mención Química', 'mencion-ciencias', 'QUI'),
    ]);
    expect(problemas).toEqual([]);
  });

  it('rechaza un grupo con una sola alternativa: no hay nada que elegir', () => {
    const problemas = validateSectionComposition([core('Común'), elect('Única', 'grupo', 'A')]);
    expect(problemas.join(' ')).toContain('una sola alternativa');
  });

  it('rechaza claves repetidas dentro de un grupo', () => {
    const problemas = validateSectionComposition([
      core('Común'),
      elect('A', 'g', 'X'),
      elect('B', 'g', 'X'),
    ]);
    expect(problemas.join(' ')).toContain('repite una clave');
  });

  it('rechaza electivas sin ningún tronco común', () => {
    const problemas = validateSectionComposition([elect('A', 'g', 'X'), elect('B', 'g', 'Y')]);
    expect(problemas.join(' ')).toContain('ninguna sección común');
  });

  it('admite dos grupos electivos independientes', () => {
    const problemas = validateSectionComposition([
      core('Común'),
      elect('Cs A', 'ciencias', 'BIO'),
      elect('Cs B', 'ciencias', 'FIS'),
      elect('Idioma A', 'idioma', 'ING'),
      elect('Idioma B', 'idioma', 'FRA'),
    ]);
    expect(problemas).toEqual([]);
  });
});

describe('pickSectionsForStudent', () => {
  const comun: SectionForComposition = { id: 'c', name: 'Común', role: 'core' };
  const bio: SectionForComposition = {
    id: 'b',
    name: 'Bio',
    role: 'elective',
    electiveGroup: 'g',
    electiveKey: 'BIO',
  };
  const fis: SectionForComposition = {
    id: 'f',
    name: 'Fis',
    role: 'elective',
    electiveGroup: 'g',
    electiveKey: 'FIS',
  };

  it('sin electivas devuelve null: el camino de siempre', () => {
    const r = pickSectionsForStudent([comun], null);
    expect(r).toEqual({ sectionIds: null, hasElectives: false, missingForm: false });
  });

  it('sin electivas ignora la forma aunque venga', () => {
    expect(pickSectionsForStudent([comun], ['c']).sectionIds).toBeNull();
  });

  it('con electivas y sin forma no corrige nada', () => {
    const r = pickSectionsForStudent([comun, bio, fis], null);
    expect(r.missingForm).toBe(true);
    expect(r.sectionIds).toBeNull();
  });

  it('con forma devuelve el común más su rama, y NO la ajena', () => {
    const r = pickSectionsForStudent([comun, bio, fis], ['b']);
    expect(r.sectionIds).toEqual(['c', 'b']);
    expect(r.sectionIds).not.toContain('f');
  });

  it('el común va siempre, aunque la forma lo omita', () => {
    expect(pickSectionsForStudent([comun, bio, fis], ['b']).sectionIds).toContain('c');
  });

  it('no duplica si la forma ya incluye el común', () => {
    const r = pickSectionsForStudent([comun, bio, fis], ['c', 'b']);
    expect(r.sectionIds).toEqual(['c', 'b']);
  });
});
