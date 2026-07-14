import { NodesService } from './nodes.service';
import type { TaxonomiesService } from './taxonomies.service';
import type { JwtPayload } from '../auth/jwt-payload.types';

// NodesService.listFacets alimenta los dropdowns del banco de ítems: lista nodos
// de las taxonomías VISIBLES para el usuario, acotados por asignatura/nivel/tipo.
// Se cubre el gate de visibilidad (sin taxonomías visibles → sin fuga y sin
// query de nodos) y el camino feliz.

function user(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    userId: 'u1',
    orgId: 'org-1',
    email: 'a@b.cl',
    name: 'Test',
    roles: ['teacher'],
    activeRole: 'teacher',
    role: 'teacher',
    isPlatformAdmin: false,
    ...overrides,
  };
}

describe('NodesService.listFacets', () => {
  it('sin taxonomías visibles → [] y NO consulta nodos', async () => {
    const select = jest.fn(() => {
      throw new Error('no debe consultar nodos si no hay taxonomías visibles');
    });
    const taxonomiesService = {
      listVisible: jest.fn().mockResolvedValue([]),
    } as unknown as TaxonomiesService;

    const svc = new NodesService({ select } as never, taxonomiesService);
    const result = await svc.listFacets({}, user());

    expect(result).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it('con taxonomías visibles → devuelve los nodos de la query', async () => {
    const rows = [
      { id: 'n1', type: 'learning_objective', subjectId: 's1', gradeId: 'g1', name: 'OA1' },
      { id: 'n2', type: 'skill', subjectId: 's1', gradeId: null, name: 'Localizar' },
    ];
    const orderBy = jest.fn().mockResolvedValue(rows);
    const where = jest.fn().mockReturnValue({ orderBy });
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    const taxonomiesService = {
      listVisible: jest.fn().mockResolvedValue([{ id: 'tax-1' }, { id: 'tax-2' }]),
    } as unknown as TaxonomiesService;

    const svc = new NodesService({ select } as never, taxonomiesService);
    const result = await svc.listFacets({ subjectId: 's1', gradeId: 'g1' }, user());

    expect(result).toEqual(rows);
    expect(select).toHaveBeenCalledTimes(1);
    expect(orderBy).toHaveBeenCalledTimes(1);
  });
});
