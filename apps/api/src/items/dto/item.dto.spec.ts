import { listItemsQuerySchema } from './item.dto';

// Parsing del query del banco de ítems: el filtro facetado en cascada agrega
// `subjectId`/`gradeId` (dimensiones AND) y `taxonomyNodeGroups` (grupos AND, OR
// dentro de cada grupo). El transform de grupos es el punto más delicado del wire
// format (query param repetido, CSV por grupo), así que se cubre aquí.

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';
const UUID_C = '33333333-3333-3333-3333-333333333333';

describe('listItemsQuerySchema — filtro facetado del banco', () => {
  it('sin filtros nuevos: subjectId/gradeId/groups quedan undefined', () => {
    const q = listItemsQuerySchema.parse({});
    expect(q.subjectId).toBeUndefined();
    expect(q.gradeId).toBeUndefined();
    expect(q.taxonomyNodeGroups).toBeUndefined();
    expect(q.scope).toBe('all');
  });

  it('acepta subjectId y gradeId como uuid', () => {
    const q = listItemsQuerySchema.parse({ subjectId: UUID_A, gradeId: UUID_B });
    expect(q.subjectId).toBe(UUID_A);
    expect(q.gradeId).toBe(UUID_B);
  });

  it('un solo grupo (string CSV) → un grupo con sus ids', () => {
    const q = listItemsQuerySchema.parse({ taxonomyNodeGroups: `${UUID_A},${UUID_B}` });
    expect(q.taxonomyNodeGroups).toEqual([[UUID_A, UUID_B]]);
  });

  it('query param repetido (array) → un grupo por ocurrencia (AND entre grupos)', () => {
    const q = listItemsQuerySchema.parse({
      taxonomyNodeGroups: [`${UUID_A},${UUID_B}`, UUID_C],
    });
    expect(q.taxonomyNodeGroups).toEqual([[UUID_A, UUID_B], [UUID_C]]);
  });

  it('descarta grupos vacíos y espacios; si todo queda vacío → undefined', () => {
    const q = listItemsQuerySchema.parse({ taxonomyNodeGroups: [' , ', ''] });
    expect(q.taxonomyNodeGroups).toBeUndefined();
  });

  it('rechaza ids que no son uuid dentro de un grupo', () => {
    expect(() => listItemsQuerySchema.parse({ taxonomyNodeGroups: 'no-es-uuid' })).toThrow();
  });

  it('mantiene retrocompat: taxonomyNodeIds (OR) sigue coaccionando CSV a uuid[]', () => {
    const q = listItemsQuerySchema.parse({ taxonomyNodeIds: `${UUID_A},${UUID_B}` });
    expect(q.taxonomyNodeIds).toEqual([UUID_A, UUID_B]);
  });
});
